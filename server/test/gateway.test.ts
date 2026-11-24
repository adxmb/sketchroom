import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildApp } from "../src/app.js";
import { RoomManager, type RoomManagerOptions } from "../src/game/rooms.js";
import { originAllowed } from "../src/game/gateway.js";
import type { ServerMessage } from "../src/protocol.js";
import { createTestDb } from "./helpers.js";

type Started = Awaited<ReturnType<typeof start>>;
let server: Started | undefined;
const open: WebSocket[] = [];

afterEach(async () => {
    for (const ws of open.splice(0)) ws.terminate();
    await server?.app.close();
    await server?.db.close();
    server = undefined;
});

async function start(
    opts: {
        maxPlayers?: number;
        messagesPerSecond?: number;
        allowedOrigins?: string[];
        game?: RoomManagerOptions;
        tickMs?: number;
        maxConnectionsPerIp?: number;
        heartbeatMs?: number;
    } = {},
) {
    const db = await createTestDb();
    const rooms = new RoomManager({
        maxPlayers: opts.maxPlayers,
        ...opts.game,
    });
    const app = await buildApp({
        db,
        rooms,
        authRateLimit: 1000,
        createRoomLimit: 1000,
        messagesPerSecond: opts.messagesPerSecond,
        allowedOrigins: opts.allowedOrigins,
        tickMs: opts.tickMs,
        maxConnectionsPerIp: opts.maxConnectionsPerIp,
        heartbeatMs: opts.heartbeatMs,
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as AddressInfo).port;
    return { app, db, rooms, port };
}

/** A WebSocket with a queue, so a test can wait for the next message */
interface Client {
    ws: WebSocket;
    send(message: unknown): void;
    sendRaw(text: string): void;
    next(): Promise<ServerMessage>;
    nextOfType<T extends ServerMessage["type"]>(
        type: T,
    ): Promise<Extract<ServerMessage, { type: T }>>;
    closed: Promise<number>;
}

async function connect(headers: Record<string, string> = {}): Promise<Client> {
    const ws = new WebSocket(`ws://127.0.0.1:${server!.port}/ws`, { headers });
    open.push(ws);
    const queue: ServerMessage[] = [];
    const waiting: ((m: ServerMessage) => void)[] = [];
    ws.on("message", (data) => {
        const message = JSON.parse(data.toString()) as ServerMessage;
        const waiter = waiting.shift();
        if (waiter) waiter(message);
        else queue.push(message);
    });
    const closed = new Promise<number>((resolve) =>
        ws.on("close", (code) => resolve(code)),
    );
    await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", reject);
        ws.once("unexpected-response", (_req, res) =>
            reject(new Error(`HTTP ${res.statusCode}`)),
        );
    });
    const next = () =>
        new Promise<ServerMessage>((resolve, reject) => {
            const message = queue.shift();
            if (message) return resolve(message);
            const timer = setTimeout(
                () => reject(new Error("No message came in time")),
                3000,
            );
            waiting.push((m) => {
                clearTimeout(timer);
                resolve(m);
            });
        });
    return {
        ws,
        send: (m) => ws.send(JSON.stringify(m)),
        sendRaw: (t) => ws.send(t),
        next,
        async nextOfType(type) {
            for (;;) {
                const m = await next();
                if (m.type === type) return m as never;
            }
        },
        closed,
    };
}

async function newRoom(
    mode: "compete" | "collab" = "compete",
): Promise<string> {
    const res = await server!.app.inject({
        method: "POST",
        url: "/api/rooms",
        payload: { mode },
    });
    expect(res.statusCode).toBe(201);
    return res.json().code;
}

async function joinAsGuest(
    code: string,
    name: string,
    headers: Record<string, string> = {},
) {
    const client = await connect(headers);
    client.send({ type: "join_room", code, name });
    return client;
}

describe("creating rooms", () => {
    it("returns a room code", async () => {
        server = await start();
        const res = await server.app.inject({
            method: "POST",
            url: "/api/rooms",
            payload: { mode: "collab" },
        });
        expect(res.statusCode).toBe(201);
        expect(res.json().code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
    });

    it("rejects an unknown mode", async () => {
        server = await start();
        const res = await server.app.inject({
            method: "POST",
            url: "/api/rooms",
            payload: { mode: "chaos" },
        });
        expect(res.statusCode).toBe(400);
    });
});

describe("joining", () => {
    it("lets two guests see each other", async () => {
        server = await start();
        const code = await newRoom();
        const ann = await joinAsGuest(code, "ann");
        const welcome = await ann.nextOfType("welcome");
        expect(welcome.playerId).toBeTypeOf("string");
        const first = await ann.nextOfType("room_state");
        expect(first.room.players.map((p) => p.name)).toEqual(["ann"]);
        expect(first.room.players[0]?.isHost).toBe(true);

        const bob = await joinAsGuest(code, "bob");
        const forAnn = await ann.nextOfType("room_state");
        const forBob = await bob.nextOfType("room_state");
        expect(forAnn.room.players.map((p) => p.name)).toEqual(["ann", "bob"]);
        expect(forBob.room).toEqual(forAnn.room);
    });

    it("tells the others when a player leaves or disconnects", async () => {
        server = await start();
        const code = await newRoom();
        const ann = await joinAsGuest(code, "ann");
        const bob = await joinAsGuest(code, "bob");
        const cat = await joinAsGuest(code, "cat");
        await cat.nextOfType("room_state");

        bob.send({ type: "leave_room" });
        expect((await bob.nextOfType("left")).type).toBe("left");
        cat.ws.close();

        // Read the states that Ann gets: 1, 2, 3 players, then 2 and 1 after the two leave
        let sawThree = false;
        let view = await ann.nextOfType("room_state");
        for (;;) {
            if (view.room.players.length === 3) sawThree = true;
            if (sawThree && view.room.players.length === 1) break;
            view = await ann.nextOfType("room_state");
        }
        expect(view.room.players.map((p) => p.name)).toEqual(["ann"]);
        expect(server.rooms.view(code)?.players).toHaveLength(1);
    });

    it("keeps the room after the last player disconnects, so a reload can rejoin", async () => {
        server = await start();
        const code = await newRoom();
        const ann = await joinAsGuest(code, "ann");
        await ann.nextOfType("room_state");
        ann.ws.close();
        await ann.closed;
        await new Promise((r) => setTimeout(r, 50));
        expect(server.rooms.view(code)?.players).toEqual([]);

        const again = await joinAsGuest(code, "ann");
        const state = await again.nextOfType("room_state");
        expect(state.room.players).toMatchObject([
            { name: "ann", isHost: true },
        ]);
    });

    it("rejects a room that does not exist", async () => {
        server = await start();
        const ann = await joinAsGuest("ZZZZZ", "ann");
        const error = await ann.nextOfType("error");
        expect(error.code).toBe("room_not_found");
    });

    it("rejects a name that is in use in the room", async () => {
        server = await start();
        const code = await newRoom();
        const ann = await joinAsGuest(code, "ann");
        await ann.nextOfType("room_state");
        const other = await joinAsGuest(code, "ANN");
        expect((await other.nextOfType("error")).code).toBe("name_taken");
    });

    it("allows the same name in another room", async () => {
        server = await start();
        const one = await joinAsGuest(await newRoom(), "ann");
        const two = await joinAsGuest(await newRoom(), "ann");
        await one.nextOfType("room_state");
        await two.nextOfType("room_state");
    });

    it("rejects a guest without a name", async () => {
        server = await start();
        const client = await connect();
        client.send({ type: "join_room", code: await newRoom() });
        expect((await client.nextOfType("error")).code).toBe("name_required");
    });

    it("rejects a join when the room is full", async () => {
        server = await start({ maxPlayers: 2 });
        const code = await newRoom();
        await (await joinAsGuest(code, "ann")).nextOfType("room_state");
        await (await joinAsGuest(code, "bob")).nextOfType("room_state");
        const cat = await joinAsGuest(code, "cat");
        expect((await cat.nextOfType("error")).code).toBe("room_full");
    });

    it("rejects a second join on one connection", async () => {
        server = await start();
        const code = await newRoom();
        const ann = await joinAsGuest(code, "ann");
        await ann.nextOfType("room_state");
        ann.send({ type: "join_room", code, name: "ann2" });
        expect((await ann.nextOfType("error")).code).toBe("already_joined");
    });
});

describe("accounts", () => {
    async function register(name: string) {
        const res = await server!.app.inject({
            method: "POST",
            url: "/api/auth/register",
            payload: { username: name, password: "correct horse" },
        });
        const sid = res.cookies.find((c) => c.name === "sid")!.value;
        return { cookie: `sid=${sid}` };
    }

    it("does not let a guest use the name of an account", async () => {
        server = await start();
        await register("Sam_1");
        const guest = await joinAsGuest(await newRoom(), "sam_1");
        expect((await guest.nextOfType("error")).code).toBe("name_reserved");
    });

    it("lets an account join with its own name", async () => {
        server = await start();
        const { cookie } = await register("Sam_1");
        const code = await newRoom();
        const client = await joinAsGuest(code, "ignored_name", { cookie });
        const state = await client.nextOfType("room_state");
        expect(state.room.players).toMatchObject([
            { name: "Sam_1", isGuest: false },
        ]);
    });

    it("treats a false cookie as a guest", async () => {
        server = await start();
        const client = await joinAsGuest(await newRoom(), "ann", {
            cookie: "sid=false",
        });
        const state = await client.nextOfType("room_state");
        expect(state.room.players).toMatchObject([
            { name: "ann", isGuest: true },
        ]);
    });
});

describe("bad input", () => {
    it.each([
        ["text that is not JSON", "hello"],
        ["an unknown type", JSON.stringify({ type: "explode" })],
        [
            "a bad room code",
            JSON.stringify({ type: "join_room", code: "abc", name: "ann" }),
        ],
        [
            "a bad name",
            JSON.stringify({
                type: "join_room",
                code: "ABCDE",
                name: "no spaces",
            }),
        ],
    ])("answers %s with bad_message", async (_label, text) => {
        server = await start();
        const client = await connect();
        client.sendRaw(text);
        expect((await client.nextOfType("error")).code).toBe("bad_message");
    });

    it("closes a connection that sends too many messages", async () => {
        server = await start({ messagesPerSecond: 5 });
        const client = await connect();
        for (let i = 0; i < 10; i++) client.sendRaw("{}");
        expect(await client.closed).toBe(1008);
    });

    it("closes a connection with a very large message", async () => {
        server = await start();
        const client = await connect();
        client.sendRaw("x".repeat(10_000));
        expect(await client.closed).toBe(1009);
    });
});

describe("origin check", () => {
    it("refuses a browser from another site", async () => {
        server = await start();
        await expect(
            connect({ origin: "https://evil.example" }),
        ).rejects.toThrow("HTTP 403");
    });

    it("accepts the site's own origin", async () => {
        server = await start();
        const client = await connect({
            origin: `http://127.0.0.1:${server.port}`,
        });
        client.ws.close();
    });

    it("accepts a listed origin", async () => {
        server = await start({
            allowedOrigins: ["https://sketchroom.example"],
        });
        const client = await connect({ origin: "https://sketchroom.example" });
        client.ws.close();
    });

    it("decides in the pure function", () => {
        expect(originAllowed(undefined, "a.com", [])).toBe(true);
        expect(originAllowed("https://a.com", "a.com", [])).toBe(true);
        expect(originAllowed("https://b.com", "a.com", [])).toBe(false);
        expect(originAllowed("not a url", "a.com", [])).toBe(false);
        expect(originAllowed("https://b.com", "a.com", ["https://b.com"])).toBe(
            true,
        );
    });
});

describe("games", () => {
    type RoomMessage = Extract<ServerMessage, { type: "room_state" }>;

    /** Two players in a room. Ann is the host */
    async function twoPlayers(game: RoomManagerOptions = {}) {
        server = await start({ game, tickMs: 10 });
        const code = await newRoom();
        const ann = await joinAsGuest(code, "ann");
        const bob = await joinAsGuest(code, "bob");
        await ann.nextOfType("room_state");
        // Wait until Bob sees both players
        for (;;) {
            if ((await bob.nextOfType("room_state")).room.players.length === 2)
                break;
        }
        return { code, ann, bob };
    }

    async function nextGameState(client: Client): Promise<RoomMessage> {
        for (;;) {
            const m = await client.nextOfType("room_state");
            if (m.room.game) return m;
        }
    }

    it("starts a game and keeps the word secret", async () => {
        const { ann, bob } = await twoPlayers();
        ann.send({ type: "start_game" });
        const forAnn = await nextGameState(ann);
        const forBob = await nextGameState(bob);

        const secret = forAnn.room.game!.word;
        expect(secret).toBeTypeOf("string");
        expect(forAnn.room.game).toMatchObject({
            phase: "drawing",
            turn: 1,
            totalTurns: 4,
        });
        expect(forBob.room.game!.word).toBeNull();
        expect(forBob.room.game!.hint).toHaveLength(secret!.length);
        expect(JSON.stringify(forBob.room)).not.toContain(secret!);
        expect(forAnn.room.game!.drawerId).toBe(forAnn.room.players[0]!.id);
    });

    it("does not let a guest who is not the host start", async () => {
        const { bob } = await twoPlayers();
        bob.send({ type: "start_game" });
        expect((await bob.nextOfType("error")).code).toBe("not_host");
    });

    it("needs two players", async () => {
        server = await start();
        const ann = await joinAsGuest(await newRoom(), "ann");
        await ann.nextOfType("room_state");
        ann.send({ type: "start_game" });
        expect((await ann.nextOfType("error")).code).toBe("not_enough_players");
    });

    it("needs a room first", async () => {
        server = await start();
        const client = await connect();
        client.send({ type: "start_game" });
        expect((await client.nextOfType("error")).code).toBe("not_in_room");
    });

    it("does not start a second game", async () => {
        const { ann } = await twoPlayers();
        ann.send({ type: "start_game" });
        await nextGameState(ann);
        ann.send({ type: "start_game" });
        expect((await ann.nextOfType("error")).code).toBe("game_running");
    });

    it("plays all turns with the timers, then goes back to the lobby", async () => {
        const { ann, bob } = await twoPlayers({
            rounds: 1,
            drawMs: 120,
            revealMs: 60,
        });
        ann.send({ type: "start_game" });

        // Old lobby states can still be in the queue. Start at the first game state
        const first = (await nextGameState(ann)).room.game!;
        const seen: string[] = [`${first.turn}:${first.phase}`];
        for (;;) {
            const g = (await ann.nextOfType("room_state")).room.game;
            if (!g) break;
            seen.push(`${g.turn}:${g.phase}`);
        }
        expect(seen).toEqual([
            "1:drawing",
            "1:reveal",
            "2:drawing",
            "2:reveal",
        ]);

        // The game is over. Now the host can start again
        ann.send({ type: "start_game" });
        expect((await nextGameState(ann)).room.game!.turn).toBe(1);
        bob.ws.close();
    });

    it("stops the game when the other player disconnects", async () => {
        const { ann, bob } = await twoPlayers();
        ann.send({ type: "start_game" });
        await nextGameState(ann);
        bob.ws.close();
        for (;;) {
            const m = await ann.nextOfType("room_state");
            if (m.room.players.length === 1) {
                expect(m.room.game).toBeNull();
                break;
            }
        }
    });
});

describe("drawing", () => {
    type CanvasMessage = Extract<ServerMessage, { type: "canvas" }>;
    const dot = (id: number, extra = {}) => ({
        id,
        colour: 2,
        size: 1,
        points: [[100, 50]],
        ...extra,
    });

    /** Ann (drawer), Bob and Cat are in a room with a game that has started */
    async function startedGame() {
        server = await start({ tickMs: 10 });
        const code = await newRoom();
        const ann = await joinAsGuest(code, "ann");
        const bob = await joinAsGuest(code, "bob");
        for (;;)
            if ((await bob.nextOfType("room_state")).room.players.length === 2)
                break;
        ann.send({ type: "start_game" });
        for (;;) if ((await bob.nextOfType("room_state")).room.game) break;
        return { code, ann, bob };
    }

    it("sends the strokes of the drawer to the others, but not back to the drawer", async () => {
        const { ann, bob } = await startedGame();
        ann.send({
            type: "draw",
            stroke: dot(0, {
                points: [
                    [1, 2],
                    [3, 4],
                ],
            }),
        });
        ann.send({
            type: "draw",
            stroke: dot(0, { points: [[5, 6]], done: true }),
        });
        const first = await bob.nextOfType("draw");
        const second = await bob.nextOfType("draw");
        expect(first.stroke).toMatchObject({
            id: 0,
            colour: 2,
            points: [
                [1, 2],
                [3, 4],
            ],
        });
        expect(second.stroke).toMatchObject({ id: 0, done: true });
        // Ann gets no copy of her own strokes
        ann.send({ type: "undo_stroke" });
        await bob.nextOfType("canvas");
        await expect(ann.nextOfType("draw")).rejects.toThrow(
            "No message came in time",
        );
    });

    it("does not let a guesser draw", async () => {
        const { bob } = await startedGame();
        bob.send({ type: "draw", stroke: dot(0) });
        expect((await bob.nextOfType("error")).code).toBe("not_drawer");
        bob.send({ type: "clear_canvas" });
        expect((await bob.nextOfType("error")).code).toBe("not_drawer");
    });

    it("needs a room first", async () => {
        server = await start();
        const client = await connect();
        client.send({ type: "draw", stroke: dot(0) });
        expect((await client.nextOfType("error")).code).toBe("not_in_room");
    });

    it("rejects a point outside the board", async () => {
        const { ann } = await startedGame();
        ann.send({ type: "draw", stroke: dot(0, { points: [[9999, 0]] }) });
        expect((await ann.nextOfType("error")).code).toBe("bad_message");
    });

    it("sends the whole drawing after undo and after clear", async () => {
        const { ann, bob } = await startedGame();
        ann.send({ type: "draw", stroke: dot(0, { done: true }) });
        ann.send({ type: "draw", stroke: dot(1, { done: true }) });
        await bob.nextOfType("draw");
        await bob.nextOfType("draw");
        ann.send({ type: "undo_stroke" });
        const afterUndo = (await bob.nextOfType("canvas")) as CanvasMessage;
        expect(afterUndo.strokes.map((s) => s.id)).toEqual([0]);
        ann.send({ type: "clear_canvas" });
        expect(
            ((await bob.nextOfType("canvas")) as CanvasMessage).strokes,
        ).toEqual([]);
    });

    it("gives the drawing so far to a player who joins in the middle of a turn", async () => {
        const { code, ann } = await startedGame();
        ann.send({
            type: "draw",
            stroke: dot(0, { points: [[7, 8]], done: true }),
        });
        // Wait until the server has the stroke
        await new Promise((r) => setTimeout(r, 50));
        const cat = await joinAsGuest(code, "cat");
        const canvas = await cat.nextOfType("canvas");
        expect(canvas.strokes).toMatchObject([
            { id: 0, points: [[7, 8]], done: true },
        ]);
    });

    it("does not send a canvas message to a player who joins an empty drawing", async () => {
        const { code } = await startedGame();
        const cat = await joinAsGuest(code, "cat");
        await cat.nextOfType("room_state");
        await expect(cat.nextOfType("canvas")).rejects.toThrow(
            "No message came in time",
        );
    });
});

describe("chat, guesses and saved scores", () => {
    type RoomMessage = Extract<ServerMessage, { type: "room_state" }>;
    type ChatMsg = Extract<ServerMessage, { type: "chat" }>;

    async function register(name: string) {
        const res = await server!.app.inject({
            method: "POST",
            url: "/api/auth/register",
            payload: { username: name, password: "correct horse" },
        });
        return {
            cookie: `sid=${res.cookies.find((c) => c.name === "sid")!.value}`,
            id: res.json().user.id as number,
        };
    }

    /** Wait for a room state that fits the test */
    async function until(
        client: Client,
        test: (m: RoomMessage) => boolean,
    ): Promise<RoomMessage> {
        for (;;) {
            const m = await client.nextOfType("room_state");
            if (test(m)) return m;
        }
    }

    /** Ann (drawer), Bob and Cat are in a room and the game has started. `word` is the secret word */
    async function startedGame(game: RoomManagerOptions = {}) {
        server = await start({ tickMs: 10, game });
        const code = await newRoom();
        const ann = await joinAsGuest(code, "ann");
        const bob = await joinAsGuest(code, "bob");
        const cat = await joinAsGuest(code, "cat");
        await until(cat, (m) => m.room.players.length === 3);
        ann.send({ type: "start_game" });
        const state = await until(ann, (m) => !!m.room.game);
        return { code, ann, bob, cat, word: state.room.game!.word! };
    }

    it("sends chat in the lobby to everyone", async () => {
        server = await start();
        const code = await newRoom();
        const ann = await joinAsGuest(code, "ann");
        const bob = await joinAsGuest(code, "bob");
        await until(bob, (m) => m.room.players.length === 2);
        ann.send({ type: "chat", text: "  hello all  " });
        for (const client of [ann, bob]) {
            const m = (await client.nextOfType("chat")) as ChatMsg;
            expect(m.message).toMatchObject({
                kind: "chat",
                name: "ann",
                text: "hello all",
                knowsWord: false,
            });
        }
    });

    it("shows a wrong guess to everyone", async () => {
        const { ann, bob, cat } = await startedGame();
        bob.send({ type: "chat", text: "zzzzz" });
        for (const client of [ann, bob, cat]) {
            expect(
                ((await client.nextOfType("chat")) as ChatMsg).message,
            ).toMatchObject({ kind: "chat", text: "zzzzz" });
        }
    });

    it("does not show the text of a correct guess, and updates scores", async () => {
        const { ann, bob, cat, word } = await startedGame();
        bob.send({ type: "chat", text: word });
        for (const client of [ann, bob, cat]) {
            const m = (await client.nextOfType("chat")) as ChatMsg;
            expect(m.message).toMatchObject({
                kind: "guessed",
                name: "bob",
                text: "",
            });
            expect(JSON.stringify(m)).not.toContain(word);
        }
        const state = await until(cat, (m) =>
            m.room.players.some((p) => p.guessed),
        );
        const bobView = state.room.players.find((p) => p.name === "bob")!;
        expect(bobView.guessed).toBe(true);
        expect(bobView.score).toBeGreaterThanOrEqual(100);
        // Cat did not guess, so the word is still secret for Cat
        expect(state.room.game!.word).toBeNull();
    });

    it("keeps the chat of the drawer away from the guessers", async () => {
        const { ann, bob, cat } = await startedGame();
        ann.send({ type: "chat", text: "it is round" });
        expect(
            ((await ann.nextOfType("chat")) as ChatMsg).message,
        ).toMatchObject({ text: "it is round", knowsWord: true });
        // Messages arrive in order. If Bob and Cat had the drawer's text, they would get it before this one
        bob.send({ type: "chat", text: "zzzzz" });
        for (const client of [bob, cat]) {
            expect(
                ((await client.nextOfType("chat")) as ChatMsg).message.text,
            ).toBe("zzzzz");
        }
    });

    it("ends the turn when everyone found the word", async () => {
        const { ann, bob, cat, word } = await startedGame({ drawMs: 60_000 });
        bob.send({ type: "chat", text: word });
        cat.send({ type: "chat", text: word.toUpperCase() });
        const state = await until(ann, (m) => m.room.game?.phase === "reveal");
        const scores = Object.fromEntries(
            state.room.players.map((p) => [p.name, p.score]),
        );
        expect(scores.ann).toBe(300);
        expect(scores.bob).toBeGreaterThan(400);
        expect(scores.cat).toBeGreaterThan(400);
    });

    it("limits how fast a player can chat", async () => {
        server = await start();
        const code = await newRoom();
        const ann = await joinAsGuest(code, "ann");
        await ann.nextOfType("room_state");
        for (let i = 0; i < 6; i++) ann.send({ type: "chat", text: `m${i}` });
        expect((await ann.nextOfType("error")).code).toBe("rate_limited");
        // The connection stays open
        expect(ann.ws.readyState).toBe(ann.ws.OPEN);
    });

    it.each([
        ["an empty text", ""],
        ["a text with a new line", "a\nb"],
        ["a text that is too long", "x".repeat(101)],
    ])("rejects %s", async (_label, text) => {
        server = await start();
        const ann = await joinAsGuest(await newRoom(), "ann");
        await ann.nextOfType("room_state");
        ann.send({ type: "chat", text });
        expect((await ann.nextOfType("error")).code).toBe("bad_message");
    });

    it("needs a room first", async () => {
        server = await start();
        const client = await connect();
        client.send({ type: "chat", text: "hi" });
        expect((await client.nextOfType("error")).code).toBe("not_in_room");
    });

    it("shows the end screen and saves the game for accounts, not for guests", async () => {
        server = await start({
            tickMs: 10,
            game: { rounds: 1, drawMs: 400, revealMs: 100 },
        });
        const amy = await register("Amy_1");
        const ben = await register("Ben_1");
        const code = await newRoom();
        const a = await joinAsGuest(code, "ignored", { cookie: amy.cookie });
        const b = await joinAsGuest(code, "ignored", { cookie: ben.cookie });
        const g = await joinAsGuest(code, "guest1");
        await until(g, (m) => m.room.players.length === 3);

        a.send({ type: "start_game" });
        const turn1 = await until(a, (m) => !!m.room.game);
        // Turn 1: Amy draws. Ben guesses at once. The guest does not. The time ends
        b.send({ type: "chat", text: turn1.room.game!.word! });
        // The other two turns end by time. Wait for the end screen
        const end = await until(g, (m) => {
            return !m.room.game && !!m.room.results;
        });
        expect(end.room.results!.players).toHaveLength(3);
        const ben1 = end.room.results!.players.find((p) => p.name === "Ben_1")!;
        expect(ben1.rank).toBe(1);
        expect(
            end.room.results!.players.find((p) => p.name === "guest1")!.isGuest,
        ).toBe(true);

        // The server saves in the same moment. Wait a short time for the database
        let rows: { user_id: number; score: number; rank: number }[] = [];
        for (let i = 0; i < 50 && rows.length < 2; i++) {
            await new Promise((r) => setTimeout(r, 20));
            rows = (
                await server.db.query<{
                    user_id: number;
                    score: number;
                    rank: number;
                }>(
                    "select user_id, score, rank from game_players order by rank, user_id",
                )
            ).rows;
        }
        expect(rows.map((r) => r.user_id).sort()).toEqual(
            [amy.id, ben.id].sort(),
        );
        expect(rows.find((r) => r.user_id === ben.id)).toMatchObject({
            rank: 1,
        });
        expect(
            (await server.db.query("select 1 from games")).rows,
        ).toHaveLength(1);
    }, 20_000);
});

describe("reconnect and limits", () => {
    type RoomMessage = Extract<ServerMessage, { type: "room_state" }>;

    const cookieA = `gid=${"a".repeat(32)}`;
    const cookieB = `gid=${"b".repeat(32)}`;

    async function until(
        client: Client,
        test: (m: RoomMessage) => boolean,
    ): Promise<RoomMessage> {
        for (;;) {
            const m = await client.nextOfType("room_state");
            if (test(m)) return m;
        }
    }

    /** Wait until the test is true. The server needs a short time to see a closed connection */
    async function eventually(test: () => boolean) {
        for (let i = 0; i < 100 && !test(); i++)
            await new Promise((r) => setTimeout(r, 20));
        expect(test()).toBe(true);
    }

    const playersOf = (code: string) => server!.rooms.view(code)!.players;

    it("gives a guest cookie one time", async () => {
        server = await start();
        const first = await server.app.inject({
            method: "POST",
            url: "/api/guest",
        });
        expect(first.statusCode).toBe(204);
        const cookie = first.cookies.find((c) => c.name === "gid")!;
        expect(cookie.value).toMatch(/^[0-9a-f]{32}$/);
        expect(cookie.httpOnly).toBe(true);
        expect(cookie.sameSite).toBe("Lax");

        const again = await server.app.inject({
            method: "POST",
            url: "/api/guest",
            cookies: { gid: cookie.value },
        });
        expect(again.statusCode).toBe(204);
        expect(again.cookies.find((c) => c.name === "gid")).toBeUndefined();

        const bad = await server.app.inject({
            method: "POST",
            url: "/api/guest",
            cookies: { gid: "not-an-id" },
        });
        expect(bad.cookies.find((c) => c.name === "gid")!.value).toMatch(
            /^[0-9a-f]{32}$/,
        );
    });

    it("gives a guest the same seat after a reload", async () => {
        server = await start();
        const code = await newRoom();
        const first = await joinAsGuest(code, "ann", { cookie: cookieA });
        const welcome = await first.nextOfType("welcome");
        await first.nextOfType("room_state");

        first.ws.terminate();
        await eventually(() => playersOf(code)[0]?.connected === false);
        expect(playersOf(code)).toHaveLength(1);

        const second = await joinAsGuest(code, "ann", { cookie: cookieA });
        expect((await second.nextOfType("welcome")).playerId).toBe(
            welcome.playerId,
        );
        const state = await second.nextOfType("room_state");
        expect(state.room.players).toHaveLength(1);
        expect(state.room.players[0]).toMatchObject({
            name: "ann",
            connected: true,
            isHost: true,
        });
    });

    it("does not give the seat to another browser that uses the same name", async () => {
        server = await start();
        const code = await newRoom();
        const first = await joinAsGuest(code, "ann", { cookie: cookieA });
        await first.nextOfType("room_state");
        first.ws.terminate();
        await eventually(() => playersOf(code)[0]?.connected === false);

        const other = await joinAsGuest(code, "ann", { cookie: cookieB });
        expect((await other.nextOfType("error")).code).toBe("name_taken");
        const none = await joinAsGuest(code, "ann");
        expect((await none.nextOfType("error")).code).toBe("name_taken");
    });

    it("lets two guests of one browser play with different names", async () => {
        server = await start();
        const code = await newRoom();
        const a = await joinAsGuest(code, "ann", { cookie: cookieA });
        const idA = (await a.nextOfType("welcome")).playerId;
        const b = await joinAsGuest(code, "bob", { cookie: cookieA });
        const idB = (await b.nextOfType("welcome")).playerId;
        expect(idA).not.toBe(idB);
        await until(b, (m) => m.room.players.length === 2);
        expect(playersOf(code).map((p) => p.connected)).toEqual([true, true]);
    });

    it("frees the name at once when a guest has no cookie", async () => {
        server = await start();
        const code = await newRoom();
        const first = await joinAsGuest(code, "ann");
        await first.nextOfType("room_state");
        first.ws.terminate();
        await eventually(() => playersOf(code).length === 0);
        const second = await joinAsGuest(code, "ann");
        expect((await second.nextOfType("welcome")).playerId).toBeTruthy();
    });

    it("shows the others when a player is away and when the player is back", async () => {
        server = await start();
        const code = await newRoom();
        const ann = await joinAsGuest(code, "ann", { cookie: cookieA });
        const bob = await joinAsGuest(code, "bob", { cookie: cookieB });
        await until(bob, (m) => m.room.players.length === 2);

        ann.ws.terminate();
        const away = await until(bob, (m) =>
            m.room.players.some((p) => p.name === "ann" && !p.connected),
        );
        expect(away.room.players).toHaveLength(2);

        const back = await joinAsGuest(code, "ann", { cookie: cookieA });
        await back.nextOfType("welcome");
        await until(bob, (m) => m.room.players.every((p) => p.connected));
    });

    it("removes a player who does not come back in time", async () => {
        server = await start({ tickMs: 10, game: { reconnectMs: 150 } });
        const code = await newRoom();
        const ann = await joinAsGuest(code, "ann", { cookie: cookieA });
        const bob = await joinAsGuest(code, "bob", { cookie: cookieB });
        await until(bob, (m) => m.room.players.length === 2);
        ann.ws.terminate();
        const gone = await until(bob, (m) => m.room.players.length === 1);
        expect(gone.room.players[0]).toMatchObject({
            name: "bob",
            isHost: true,
        });
    });

    it("lets an account take its seat with a new connection, and closes the old one", async () => {
        server = await start();
        const reg = await server.app.inject({
            method: "POST",
            url: "/api/auth/register",
            payload: { username: "Amy_1", password: "correct horse" },
        });
        const cookie = `sid=${reg.cookies.find((c) => c.name === "sid")!.value}`;
        const code = await newRoom();
        const first = await joinAsGuest(code, "ignored", { cookie });
        const welcome = await first.nextOfType("welcome");
        await first.nextOfType("room_state");

        const second = await joinAsGuest(code, "ignored", { cookie });
        expect((await second.nextOfType("welcome")).playerId).toBe(
            welcome.playerId,
        );
        expect(await first.closed).toBe(4000);
        // The old connection is closed now. The player must still be in the room, and connected
        await new Promise((r) => setTimeout(r, 100));
        expect(playersOf(code)).toHaveLength(1);
        expect(playersOf(code)[0]).toMatchObject({
            name: "Amy_1",
            connected: true,
        });
    });

    it("keeps the game running for a player who comes back", async () => {
        server = await start({ tickMs: 10 });
        const code = await newRoom();
        const ann = await joinAsGuest(code, "ann", { cookie: cookieA });
        const bob = await joinAsGuest(code, "bob", { cookie: cookieB });
        await until(bob, (m) => m.room.players.length === 2);
        ann.send({ type: "start_game" });
        await until(bob, (m) => !!m.room.game);

        bob.ws.terminate();
        await eventually(() =>
            playersOf(code).some((p) => p.name === "bob" && !p.connected),
        );
        const back = await joinAsGuest(code, "bob", { cookie: cookieB });
        const state = await until(back, (m) => !!m.room.game);
        expect(state.room.game!.turn).toBe(1);
        expect(state.room.players.every((p) => p.connected)).toBe(true);
    });

    it("limits the connections of one IP address", async () => {
        server = await start({ maxConnectionsPerIp: 2 });
        await connect();
        const second = await connect();
        await expect(connect()).rejects.toThrow("HTTP 429");
        // A closed connection gives its place back
        second.ws.close();
        await second.closed;
        await new Promise((r) => setTimeout(r, 50));
        await connect();
    });

    it("closes a connection that fails too many joins", async () => {
        server = await start();
        const client = await connect();
        for (let i = 0; i < 10; i++)
            client.send({ type: "join_room", code: "ZZZZZ", name: "ann" });
        expect(await client.closed).toBe(1008);
    });

    it("closes a connection that does not answer pings, and keeps one that does", async () => {
        server = await start({ heartbeatMs: 50 });
        const good = await connect();
        const dead = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
            autoPong: false,
        });
        open.push(dead);
        const deadClosed = new Promise<void>((resolve) =>
            dead.on("close", () => resolve()),
        );
        await deadClosed;
        expect(good.ws.readyState).toBe(good.ws.OPEN);
    });
});
