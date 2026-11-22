import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildApp } from "../src/app.js";
import { RoomManager } from "../src/game/rooms.js";
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
    } = {},
) {
    const db = await createTestDb();
    const rooms = new RoomManager({ maxPlayers: opts.maxPlayers });
    const app = await buildApp({
        db,
        rooms,
        authRateLimit: 1000,
        createRoomLimit: 1000,
        messagesPerSecond: opts.messagesPerSecond,
        allowedOrigins: opts.allowedOrigins,
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
