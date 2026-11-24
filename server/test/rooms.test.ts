import { describe, expect, it } from "vitest";
import { RoomManager } from "../src/game/rooms.js";

function setup(opts = {}) {
    const manager = new RoomManager({ makeCode: counterCodes(), ...opts });
    const created = manager.createRoom("compete");
    if (!created.ok) throw new Error("no room");
    return { manager, code: created.code };
}

function counterCodes() {
    let n = 0;
    return () => `ROOM${(n++ % 9) + 1}`;
}

describe("RoomManager", () => {
    it("makes codes from the safe alphabet", () => {
        const manager = new RoomManager();
        for (let i = 0; i < 50; i++) {
            const r = manager.createRoom("compete");
            expect(r.ok && /^[A-HJ-NP-Z2-9]{5}$/.test(r.code)).toBe(true);
        }
    });

    it("makes the first player the host", () => {
        const { manager, code } = setup();
        const a = manager.join(code, { name: "ann", userId: null });
        const b = manager.join(code, { name: "bob", userId: 7 });
        expect(a.ok && b.ok).toBe(true);
        if (!b.ok) return;
        expect(
            b.room.players.map((p) => [p.name, p.isHost, p.isGuest]),
        ).toEqual([
            ["ann", true, true],
            ["bob", false, false],
        ]);
    });

    it("rejects a name in use, with any letter case", () => {
        const { manager, code } = setup();
        manager.join(code, { name: "Ann", userId: null });
        expect(manager.join(code, { name: "aNN", userId: null })).toEqual({
            ok: false,
            error: "name_taken",
        });
    });

    it("frees a name when the player leaves", () => {
        const { manager, code } = setup();
        const a = manager.join(code, { name: "ann", userId: null });
        manager.join(code, { name: "bob", userId: null });
        if (!a.ok) throw new Error();
        manager.leave(code, a.player.id);
        expect(manager.join(code, { name: "ANN", userId: null }).ok).toBe(true);
    });

    it("rejects an unknown room", () => {
        const { manager } = setup();
        expect(manager.join("ZZZZZ", { name: "ann", userId: null })).toEqual({
            ok: false,
            error: "room_not_found",
        });
    });

    it("rejects a player when the room is full", () => {
        const { manager, code } = setup({ maxPlayers: 2 });
        manager.join(code, { name: "ann", userId: null });
        manager.join(code, { name: "bob", userId: null });
        expect(manager.join(code, { name: "cat", userId: null })).toEqual({
            ok: false,
            error: "room_full",
        });
    });

    it("gives the host role to the next player when the host leaves", () => {
        const { manager, code } = setup();
        const a = manager.join(code, { name: "ann", userId: null });
        manager.join(code, { name: "bob", userId: null });
        manager.join(code, { name: "cat", userId: null });
        if (!a.ok) throw new Error();
        const view = manager.leave(code, a.player.id)!;
        expect(view.players.map((p) => [p.name, p.isHost])).toEqual([
            ["bob", true],
            ["cat", false],
        ]);
    });

    it("keeps an empty room for a short time so a player can rejoin", () => {
        let now = 1_000;
        const manager = new RoomManager({
            now: () => now,
            emptyTtlMs: 60_000,
            makeCode: counterCodes(),
        });
        const created = manager.createRoom("compete");
        if (!created.ok) throw new Error();
        const a = manager.join(created.code, { name: "ann", userId: null });
        if (!a.ok) throw new Error();

        expect(manager.leave(created.code, a.player.id)?.players).toEqual([]);
        now += 59_000;
        expect(manager.sweep()).toBe(0);
        const again = manager.join(created.code, { name: "ann", userId: null });
        expect(again.ok && again.room.players[0]?.isHost).toBe(true);

        // Empty again. This time nobody returns
        if (!again.ok) throw new Error();
        manager.leave(created.code, again.player.id);
        now += 61_000;
        expect(manager.sweep()).toBe(1);
        expect(manager.view(created.code)).toBeNull();
        expect(manager.size).toBe(0);
    });

    it("ignores a second leave from the same player", () => {
        const { manager, code } = setup();
        const a = manager.join(code, { name: "ann", userId: null });
        manager.join(code, { name: "bob", userId: null });
        if (!a.ok) throw new Error();
        manager.leave(code, a.player.id);
        expect(manager.leave(code, a.player.id)?.players).toHaveLength(1);
    });

    it("removes a room that nobody joined after the time limit", () => {
        let now = 1_000;
        const manager = new RoomManager({
            now: () => now,
            unusedTtlMs: 600_000,
        });
        const unused = manager.createRoom("compete");
        const used = manager.createRoom("compete");
        if (!unused.ok || !used.ok) throw new Error();
        manager.join(used.code, { name: "ann", userId: null });
        now += 599_000;
        expect(manager.sweep()).toBe(0);
        now += 2_000;
        expect(manager.sweep()).toBe(1);
        expect(manager.view(unused.code)).toBeNull();
        expect(manager.view(used.code)).not.toBeNull();
    });

    it("limits the number of rooms", () => {
        const manager = new RoomManager({
            maxRooms: 2,
            makeCode: counterCodes(),
        });
        expect(manager.createRoom("compete").ok).toBe(true);
        expect(manager.createRoom("collab").ok).toBe(true);
        expect(manager.createRoom("compete")).toEqual({
            ok: false,
            error: "too_many_rooms",
        });
    });
});

describe("games", () => {
    const WORDS = ["apple", "ice cream", "robot", "tiger"];

    /** A room with the given players. `now` is a clock that the test controls */
    function gameSetup(
        names: string[],
        opts: { rounds?: number; minPlayers?: number } = {},
    ) {
        const clock = { now: 1_000 };
        const manager = new RoomManager({
            now: () => clock.now,
            makeCode: counterCodes(),
            drawMs: 60_000,
            revealMs: 5_000,
            rounds: 1,
            ...opts,
        });
        const created = manager.createRoom("compete");
        if (!created.ok) throw new Error();
        const ids = names.map((name) => {
            const r = manager.join(created.code, { name, userId: null });
            if (!r.ok) throw new Error();
            return r.player.id;
        });
        return { manager, code: created.code, ids, clock };
    }

    it("lets only the host start, and only with enough players", () => {
        const { manager, code, ids } = gameSetup(["ann", "bob"]);
        expect(manager.startGame(code, ids[1]!, WORDS)).toEqual({
            ok: false,
            error: "not_host",
        });
        expect(manager.startGame("ZZZZZ", ids[0]!, WORDS)).toEqual({
            ok: false,
            error: "room_not_found",
        });
        expect(manager.startGame(code, ids[0]!, WORDS)).toEqual({ ok: true });
        expect(manager.startGame(code, ids[0]!, WORDS)).toEqual({
            ok: false,
            error: "game_running",
        });

        const alone = gameSetup(["ann"]);
        expect(
            alone.manager.startGame(alone.code, alone.ids[0]!, WORDS),
        ).toEqual({
            ok: false,
            error: "not_enough_players",
        });
    });

    it("shows the secret word only to the drawer", () => {
        const { manager, code, ids } = gameSetup(["ann", "bob", "cat"]);
        manager.startGame(code, ids[0]!, WORDS);
        const forDrawer = manager.view(code, ids[0]!)!.game!;
        const forGuesser = manager.view(code, ids[1]!)!.game!;
        const forNobody = manager.view(code)!.game!;
        expect(forDrawer).toMatchObject({
            phase: "drawing",
            turn: 1,
            totalTurns: 3,
            drawerId: ids[0],
            word: "apple",
        });
        expect(forGuesser.word).toBeNull();
        expect(forNobody.word).toBeNull();
        expect(forGuesser.hint).toBe("_____");
        expect(JSON.stringify(forGuesser)).not.toContain("apple");
    });

    it("counts down the time that is left", () => {
        const { manager, code, ids, clock } = gameSetup(["ann", "bob"]);
        manager.startGame(code, ids[0]!, WORDS);
        expect(manager.view(code)!.game!.msLeft).toBe(60_000);
        clock.now += 20_000;
        expect(manager.view(code)!.game!.msLeft).toBe(40_000);
    });

    it("does nothing on a tick before the timer ends", () => {
        const { manager, code, ids, clock } = gameSetup(["ann", "bob"]);
        manager.startGame(code, ids[0]!, WORDS);
        clock.now += 59_999;
        expect(manager.tick()).toEqual([]);
    });

    it("goes through reveal and turns, then back to the lobby", () => {
        const { manager, code, ids, clock } = gameSetup(["ann", "bob"]);
        manager.startGame(code, ids[0]!, WORDS);

        clock.now += 60_000;
        expect(manager.tick()).toEqual([code]);
        // Reveal: everyone can see the word
        expect(manager.view(code, ids[1]!)!.game).toMatchObject({
            phase: "reveal",
            word: "apple",
            msLeft: 5_000,
        });

        clock.now += 5_000;
        expect(manager.tick()).toEqual([code]);
        expect(manager.view(code, ids[1]!)!.game).toMatchObject({
            phase: "drawing",
            turn: 2,
            drawerId: ids[1],
            word: "ice cream",
            hint: "___ _____",
        });
        expect(manager.view(code, ids[0]!)!.game!.word).toBeNull();

        clock.now += 60_000;
        manager.tick();
        clock.now += 5_000;
        manager.tick();
        expect(manager.view(code)!.game).toBeNull();
        // The host can start again
        expect(manager.startGame(code, ids[0]!, WORDS)).toEqual({ ok: true });
    });

    it("uses the rounds setting", () => {
        const { manager, code, ids } = gameSetup(["ann", "bob"], { rounds: 2 });
        manager.startGame(code, ids[0]!, WORDS);
        expect(manager.view(code)!.game!.totalTurns).toBe(4);
    });

    it("has no more turns than words", () => {
        const { manager, code, ids } = gameSetup(["ann", "bob", "cat"], {
            rounds: 2,
        });
        manager.startGame(code, ids[0]!, ["apple", "robot"]);
        expect(manager.view(code)!.game!.totalTurns).toBe(2);
    });

    it("ends the turn at once when the drawer leaves", () => {
        const { manager, code, ids, clock } = gameSetup(["ann", "bob", "cat"]);
        manager.startGame(code, ids[0]!, WORDS);
        manager.leave(code, ids[0]!);
        expect(manager.view(code, ids[1]!)!.game).toMatchObject({
            phase: "reveal",
            word: "apple",
            msLeft: 5_000,
        });
        clock.now += 5_000;
        manager.tick();
        expect(manager.view(code, ids[1]!)!.game).toMatchObject({
            phase: "drawing",
            drawerId: ids[1],
        });
    });

    it("does not end the turn when a guesser leaves", () => {
        const { manager, code, ids } = gameSetup(["ann", "bob", "cat"]);
        manager.startGame(code, ids[0]!, WORDS);
        manager.leave(code, ids[2]!);
        expect(manager.view(code)!.game).toMatchObject({
            phase: "drawing",
            drawerId: ids[0],
        });
    });

    it("skips the turns of a player who left", () => {
        const { manager, code, ids, clock } = gameSetup(["ann", "bob", "cat"]);
        manager.startGame(code, ids[0]!, WORDS);
        manager.leave(code, ids[1]!);
        clock.now += 60_000;
        manager.tick();
        clock.now += 5_000;
        manager.tick();
        expect(manager.view(code, ids[2]!)!.game).toMatchObject({
            drawerId: ids[2],
            turn: 3,
        });
    });

    it("stops the game when too few players are left", () => {
        const { manager, code, ids } = gameSetup(["ann", "bob"]);
        manager.startGame(code, ids[0]!, WORDS);
        manager.leave(code, ids[1]!);
        expect(manager.view(code)!.game).toBeNull();
    });
});

describe("drawing", () => {
    const dot = (id: number, extra = {}) => ({
        id,
        colour: 1,
        size: 1,
        points: [[10, 10]] as [number, number][],
        ...extra,
    });

    function drawSetup() {
        const clock = { now: 1_000 };
        const manager = new RoomManager({
            now: () => clock.now,
            makeCode: counterCodes(),
            rounds: 1,
        });
        const created = manager.createRoom("compete");
        if (!created.ok) throw new Error();
        const ids = ["ann", "bob", "cat"].map((name) => {
            const r = manager.join(created.code, { name, userId: null });
            if (!r.ok) throw new Error();
            return r.player.id;
        });
        manager.startGame(created.code, ids[0]!, ["apple", "robot", "tiger"]);
        return { manager, code: created.code, ids, clock };
    }

    it("lets the drawer add strokes", () => {
        const { manager, code, ids } = drawSetup();
        const result = manager.draw(code, ids[0]!, dot(0, { done: true }));
        expect(result.ok).toBe(true);
        expect(manager.strokes(code)).toHaveLength(1);
    });

    it("does not let a guesser draw, clear or undo", () => {
        const { manager, code, ids } = drawSetup();
        expect(manager.draw(code, ids[1]!, dot(0))).toEqual({
            ok: false,
            error: "not_drawer",
        });
        manager.draw(code, ids[0]!, dot(0, { done: true }));
        expect(manager.undoStroke(code, ids[1]!)).toBe(false);
        expect(manager.clearCanvas(code, ids[1]!)).toBe(false);
        expect(manager.strokes(code)).toHaveLength(1);
    });

    it("does not let a player draw in the lobby", () => {
        const manager = new RoomManager();
        const created = manager.createRoom("compete");
        if (!created.ok) throw new Error();
        const a = manager.join(created.code, { name: "ann", userId: null });
        if (!a.ok) throw new Error();
        expect(manager.draw(created.code, a.player.id, dot(0))).toEqual({
            ok: false,
            error: "not_drawer",
        });
        expect(manager.strokes(created.code)).toEqual([]);
    });

    it("undoes the last stroke and clears all strokes", () => {
        const { manager, code, ids } = drawSetup();
        manager.draw(code, ids[0]!, dot(0, { done: true }));
        manager.draw(code, ids[0]!, dot(1, { done: true }));
        expect(manager.undoStroke(code, ids[0]!)).toBe(true);
        expect(manager.strokes(code).map((s) => s.id)).toEqual([0]);
        expect(manager.clearCanvas(code, ids[0]!)).toBe(true);
        expect(manager.strokes(code)).toEqual([]);
    });

    it("keeps the drawing in the reveal but does not allow new strokes", () => {
        const { manager, code, ids, clock } = drawSetup();
        manager.draw(code, ids[0]!, dot(0, { done: true }));
        clock.now += 60_000;
        manager.tick();
        expect(manager.view(code)!.game!.phase).toBe("reveal");
        expect(manager.strokes(code)).toHaveLength(1);
        expect(manager.draw(code, ids[0]!, dot(1))).toEqual({
            ok: false,
            error: "not_drawer",
        });
        expect(manager.clearCanvas(code, ids[0]!)).toBe(false);
    });

    it("starts each turn with an empty drawing", () => {
        const { manager, code, ids, clock } = drawSetup();
        manager.draw(code, ids[0]!, dot(0, { done: true }));
        clock.now += 60_000;
        manager.tick();
        clock.now += 5_000;
        manager.tick();
        expect(manager.view(code)!.game!.turn).toBe(2);
        expect(manager.strokes(code)).toEqual([]);
        // The new drawer starts again at id 0
        expect(manager.draw(code, ids[1]!, dot(0)).ok).toBe(true);
    });

    it("reports when the drawing is too big", () => {
        const { manager, code, ids } = drawSetup();
        let result: ReturnType<typeof manager.draw> = {
            ok: true,
            chunk: dot(0),
        };
        for (let id = 0; id < 301 && result.ok; id++)
            result = manager.draw(code, ids[0]!, dot(id, { done: true }));
        expect(result).toEqual({ ok: false, error: "canvas_limit" });
    });
});

describe("guessing and scores", () => {
    const WORDS = ["apple", "robot", "tiger"];

    function playSetup(names: string[], opts: { rounds?: number } = {}) {
        const clock = { now: 1_000 };
        const manager = new RoomManager({
            now: () => clock.now,
            makeCode: counterCodes(),
            drawMs: 60_000,
            revealMs: 5_000,
            rounds: 1,
            ...opts,
        });
        const created = manager.createRoom("compete");
        if (!created.ok) throw new Error();
        const ids = names.map((name) => {
            const r = manager.join(created.code, { name, userId: null });
            if (!r.ok) throw new Error();
            return r.player.id;
        });
        manager.startGame(created.code, ids[0]!, WORDS);
        const scores = () =>
            Object.fromEntries(
                manager
                    .view(created.code)!
                    .players.map((p) => [p.name, p.score]),
            );
        return { manager, code: created.code, ids, clock, scores };
    }

    it("sends chat in the lobby to everyone", () => {
        const manager = new RoomManager();
        const created = manager.createRoom("compete");
        if (!created.ok) throw new Error();
        const a = manager.join(created.code, { name: "ann", userId: null });
        if (!a.ok) throw new Error();
        const out = manager.chat(created.code, a.player.id, "hello")!;
        expect(out.stateChanged).toBe(false);
        expect(out.deliveries).toEqual([
            {
                to: "all",
                message: {
                    kind: "chat",
                    playerId: a.player.id,
                    name: "ann",
                    text: "hello",
                    knowsWord: false,
                },
            },
        ]);
    });

    it("returns null for a player who is not in the room", () => {
        const { manager, code } = playSetup(["ann", "bob"]);
        expect(manager.chat(code, "nobody", "hi")).toBeNull();
        expect(manager.chat("ZZZZZ", "nobody", "hi")).toBeNull();
    });

    it("shows a wrong guess to everyone and gives no points", () => {
        const { manager, code, ids, scores } = playSetup(["ann", "bob", "cat"]);
        const out = manager.chat(code, ids[1]!, "banana")!;
        expect(out.stateChanged).toBe(false);
        expect(out.deliveries).toHaveLength(1);
        expect(out.deliveries[0]).toMatchObject({
            to: "all",
            message: { kind: "chat", text: "banana", knowsWord: false },
        });
        expect(scores()).toEqual({ ann: 0, bob: 0, cat: 0 });
    });

    it("does not send the text of a correct guess", () => {
        const { manager, code, ids } = playSetup(["ann", "bob", "cat"]);
        const out = manager.chat(code, ids[1]!, "  APPLE ")!;
        expect(out.stateChanged).toBe(true);
        expect(out.deliveries).toEqual([
            {
                to: "all",
                message: {
                    kind: "guessed",
                    playerId: ids[1],
                    name: "bob",
                    text: "",
                    knowsWord: false,
                },
            },
        ]);
        expect(JSON.stringify(out)).not.toMatch(/apple/i);
    });

    it("gives more points for a fast guess", () => {
        const { manager, code, ids, clock, scores } = playSetup([
            "ann",
            "bob",
            "cat",
        ]);
        manager.chat(code, ids[1]!, "apple");
        clock.now += 30_000;
        manager.chat(code, ids[2]!, "apple");
        expect(scores()).toEqual({ ann: 300, bob: 500, cat: 300 }); // Ann is the drawer. Her points came at the end of the turn
    });

    it("marks the players who found the word", () => {
        const { manager, code, ids } = playSetup(["ann", "bob", "cat"]);
        manager.chat(code, ids[1]!, "apple");
        const guessed = Object.fromEntries(
            manager.view(code)!.players.map((p) => [p.name, p.guessed]),
        );
        expect(guessed).toEqual({ ann: false, bob: true, cat: false });
    });

    it("keeps the chat of the drawer and of players who found the word between them", () => {
        const { manager, code, ids } = playSetup(["ann", "bob", "cat"]);
        const fromDrawer = manager.chat(code, ids[0]!, "it is red")!;
        expect(fromDrawer.deliveries).toEqual([
            {
                to: [ids[0]],
                message: expect.objectContaining({
                    kind: "chat",
                    text: "it is red",
                    knowsWord: true,
                }),
            },
        ]);
        manager.chat(code, ids[1]!, "apple");
        const fromBob = manager.chat(code, ids[1]!, "easy one")!;
        expect(fromBob.deliveries[0]!.to).toEqual([ids[0], ids[1]]);
        expect(fromBob.deliveries[0]!.message.knowsWord).toBe(true);
    });

    it("does not give points two times to the same player", () => {
        const { manager, code, ids, scores } = playSetup(["ann", "bob", "cat"]);
        manager.chat(code, ids[1]!, "apple");
        manager.chat(code, ids[1]!, "apple");
        expect(scores().bob).toBe(500);
    });

    it("tells a guesser privately when the guess is close", () => {
        const { manager, code, ids } = playSetup(["ann", "bob", "cat"]);
        const out = manager.chat(code, ids[1]!, "apples")!;
        expect(out.deliveries).toHaveLength(2);
        expect(out.deliveries[0]).toMatchObject({
            to: "all",
            message: { kind: "chat", text: "apples" },
        });
        expect(out.deliveries[1]).toMatchObject({
            to: [ids[1]],
            message: { kind: "close", text: "" },
        });
    });

    it("ends the turn when all guessers found the word, and pays the drawer", () => {
        const { manager, code, ids, scores } = playSetup(["ann", "bob", "cat"]);
        manager.chat(code, ids[1]!, "apple");
        expect(manager.view(code)!.game!.phase).toBe("drawing");
        manager.chat(code, ids[2]!, "apple");
        expect(manager.view(code)!.game!.phase).toBe("reveal");
        expect(scores()).toEqual({ ann: 300, bob: 500, cat: 500 });
        // After the turn ends, a guess is only chat
        expect(
            manager.chat(code, ids[2]!, "apple")!.deliveries[0],
        ).toMatchObject({ message: { kind: "chat", knowsWord: false } });
    });

    it("pays the drawer for the share of guessers who found the word", () => {
        const { manager, code, ids, clock, scores } = playSetup([
            "ann",
            "bob",
            "cat",
        ]);
        manager.chat(code, ids[1]!, "apple");
        clock.now += 60_000;
        manager.tick();
        expect(scores().ann).toBe(150);
    });

    it("pays the drawer nothing when nobody found the word", () => {
        const { manager, clock, scores } = playSetup(["ann", "bob"]);
        clock.now += 60_000;
        manager.tick();
        expect(scores()).toEqual({ ann: 0, bob: 0 });
    });

    it("ends the turn when the guessers who are left all found the word", () => {
        const { manager, code, ids, scores } = playSetup(["ann", "bob", "cat"]);
        manager.chat(code, ids[1]!, "apple");
        manager.leave(code, ids[2]!);
        expect(manager.view(code)!.game!.phase).toBe("reveal");
        expect(scores()).toEqual({ ann: 300, bob: 500 });
    });

    it("gives no points to the drawer who leaves, and removes the score of the player", () => {
        const { manager, code, ids } = playSetup(["ann", "bob", "cat"]);
        manager.chat(code, ids[1]!, "apple");
        manager.leave(code, ids[0]!);
        expect(manager.view(code)!.game!.phase).toBe("reveal");
        const names = manager.view(code)!.players.map((p) => p.name);
        expect(names).toEqual(["bob", "cat"]);
    });

    it("clears who found the word when the next turn starts", () => {
        const { manager, code, ids, clock } = playSetup(["ann", "bob"]);
        manager.chat(code, ids[1]!, "apple");
        clock.now += 5_000;
        manager.tick();
        const view = manager.view(code)!;
        expect(view.game!.turn).toBe(2);
        expect(view.players.every((p) => !p.guessed)).toBe(true);
    });

    it("ends the game with ranked results, and keeps them for the end screen", () => {
        const { manager, code, ids, clock } = playSetup(["ann", "bob"]);
        expect(manager.view(code)!.results).toBeNull();
        manager.chat(code, ids[1]!, "apple"); // Bob: 500. Ann gets 300 when the turn ends
        clock.now += 5_000;
        manager.tick(); // The reveal is over. Turn 2: Bob draws
        clock.now += 30_000;
        manager.chat(code, ids[0]!, "robot"); // Ann: 300. Bob gets 300
        clock.now += 5_000;
        manager.tick(); // The last reveal is over. The game ends
        const view = manager.view(code)!;
        expect(view.game).toBeNull();
        expect(view.results).toEqual({
            players: [
                { name: "bob", score: 800, rank: 1, isGuest: true },
                { name: "ann", score: 600, rank: 2, isGuest: true },
            ],
        });
        expect(view.players.map((p) => p.score)).toEqual([0, 0]);
    });

    it("gives each finished game one time, with the account ids", () => {
        const clock = { now: 1_000 };
        const manager = new RoomManager({
            now: () => clock.now,
            makeCode: counterCodes(),
            rounds: 1,
        });
        const created = manager.createRoom("compete");
        if (!created.ok) throw new Error();
        const a = manager.join(created.code, { name: "ann", userId: 7 });
        const b = manager.join(created.code, { name: "bob", userId: null });
        if (!a.ok || !b.ok) throw new Error();
        manager.startGame(created.code, a.player.id, WORDS);
        for (let i = 0; i < 4; i++) {
            clock.now += 60_000;
            manager.tick();
        }
        const finished = manager.takeFinished();
        expect(finished).toEqual([
            {
                code: created.code,
                rounds: 1,
                players: [
                    { userId: 7, name: "ann", score: 0, rank: 1 },
                    { userId: null, name: "bob", score: 0, rank: 1 },
                ],
            },
        ]);
        expect(manager.takeFinished()).toEqual([]);
    });

    it("does not count a game that stopped early", () => {
        const { manager, code, ids } = playSetup(["ann", "bob"]);
        manager.leave(code, ids[1]!);
        expect(manager.view(code)!.game).toBeNull();
        expect(manager.view(code)!.results).toBeNull();
        expect(manager.takeFinished()).toEqual([]);
    });

    it("clears the old results when a new game starts", () => {
        const { manager, code, ids, clock } = playSetup(["ann", "bob"]);
        for (let i = 0; i < 4; i++) {
            clock.now += 60_000;
            manager.tick();
        }
        expect(manager.view(code)!.results).not.toBeNull();
        manager.startGame(code, ids[0]!, WORDS);
        expect(manager.view(code)!.results).toBeNull();
    });
});

describe("reconnecting", () => {
    const WORDS = ["apple", "robot", "tiger"];

    /** Ann, Bob and Cat have an owner each, so they can come back */
    function reconSetup(names = ["ann", "bob", "cat"], owned = true) {
        const clock = { now: 1_000 };
        const manager = new RoomManager({
            now: () => clock.now,
            makeCode: counterCodes(),
            drawMs: 60_000,
            revealMs: 5_000,
            reconnectMs: 30_000,
            rounds: 1,
        });
        const created = manager.createRoom("compete");
        if (!created.ok) throw new Error();
        const ids = names.map((name) => {
            const r = manager.join(created.code, {
                name,
                userId: null,
                owner: owned ? `g:${name}` : null,
            });
            if (!r.ok) throw new Error();
            return r.player.id;
        });
        return { manager, code: created.code, ids, clock };
    }

    const connectedOf = (m: RoomManager, code: string) =>
        Object.fromEntries(
            m.view(code)!.players.map((p) => [p.name, p.connected]),
        );

    it("keeps the seat of a player who has an owner", () => {
        const { manager, code, ids } = reconSetup();
        manager.disconnect(code, ids[1]!);
        expect(connectedOf(manager, code)).toEqual({
            ann: true,
            bob: false,
            cat: true,
        });
    });

    it("removes a player without an owner at once", () => {
        const { manager, code, ids } = reconSetup(["ann", "bob"], false);
        manager.disconnect(code, ids[1]!);
        expect(manager.view(code)!.players.map((p) => p.name)).toEqual(["ann"]);
    });

    it("gives the same seat to the same owner and name", () => {
        const { manager, code, ids } = reconSetup();
        manager.disconnect(code, ids[1]!);
        const back = manager.join(code, {
            name: "BOB",
            userId: null,
            owner: "g:bob",
        });
        expect(back).toMatchObject({ ok: true, resumed: true });
        if (!back.ok) return;
        expect(back.player.id).toBe(ids[1]);
        expect(manager.view(code)!.players).toHaveLength(3);
        expect(connectedOf(manager, code).bob).toBe(true);
    });

    it("takes the seat from an old connection that is not closed yet", () => {
        const { manager, code, ids } = reconSetup();
        const back = manager.join(code, {
            name: "bob",
            userId: null,
            owner: "g:bob",
        });
        expect(back).toMatchObject({ ok: true, resumed: true });
        expect(back.ok && back.player.id).toBe(ids[1]);
        expect(manager.view(code)!.players).toHaveLength(3);
    });

    it("does not give the seat to another owner, or to a player without an owner", () => {
        const { manager, code, ids } = reconSetup();
        manager.disconnect(code, ids[1]!);
        expect(
            manager.join(code, { name: "bob", userId: null, owner: "g:other" }),
        ).toEqual({
            ok: false,
            error: "name_taken",
        });
        expect(
            manager.join(code, { name: "bob", userId: null, owner: null }),
        ).toEqual({
            ok: false,
            error: "name_taken",
        });
    });

    it("removes the player when the time to come back is over", () => {
        const { manager, code, ids, clock } = reconSetup();
        manager.disconnect(code, ids[1]!);
        clock.now += 29_000;
        expect(manager.tick()).toEqual([]);
        expect(manager.view(code)!.players).toHaveLength(3);
        clock.now += 1_000;
        expect(manager.tick()).toEqual([code]);
        expect(manager.view(code)!.players.map((p) => p.name)).toEqual([
            "ann",
            "cat",
        ]);
    });

    it("keeps the host while the host is away, and moves the host after the time ends", () => {
        const { manager, code, ids, clock } = reconSetup();
        manager.disconnect(code, ids[0]!);
        expect(manager.view(code)!.players.find((p) => p.isHost)!.name).toBe(
            "ann",
        );
        clock.now += 30_000;
        manager.tick();
        expect(manager.view(code)!.players.find((p) => p.isHost)!.name).toBe(
            "bob",
        );
    });

    it("keeps the score of a player who comes back", () => {
        const { manager, code, ids } = reconSetup();
        manager.startGame(code, ids[0]!, WORDS);
        manager.chat(code, ids[1]!, "apple");
        manager.disconnect(code, ids[1]!);
        manager.join(code, { name: "bob", userId: null, owner: "g:bob" });
        const bob = manager.view(code)!.players.find((p) => p.name === "bob")!;
        expect(bob).toMatchObject({ guessed: true, connected: true });
        expect(bob.score).toBe(500);
    });

    it("does not wait for a guesser who is away", () => {
        const { manager, code, ids } = reconSetup();
        manager.startGame(code, ids[0]!, WORDS);
        manager.disconnect(code, ids[2]!);
        expect(manager.view(code)!.game!.phase).toBe("drawing");
        manager.chat(code, ids[1]!, "apple");
        expect(manager.view(code)!.game!.phase).toBe("reveal");
    });

    it("ends the turn at once when the last guesser who is not done goes away", () => {
        const { manager, code, ids } = reconSetup();
        manager.startGame(code, ids[0]!, WORDS);
        manager.chat(code, ids[1]!, "apple");
        manager.disconnect(code, ids[2]!);
        expect(manager.view(code)!.game!.phase).toBe("reveal");
    });

    it("ends the turn without points when the drawer does not come back", () => {
        const { manager, code, ids, clock } = reconSetup();
        manager.startGame(code, ids[0]!, WORDS);
        manager.chat(code, ids[1]!, "apple");
        manager.disconnect(code, ids[0]!);
        expect(manager.view(code)!.game!.phase).toBe("drawing");
        clock.now += 30_000;
        manager.tick();
        const view = manager.view(code)!;
        expect(view.game!.phase).toBe("reveal");
        expect(view.players.map((p) => p.name)).toEqual(["bob", "cat"]);
    });

    it("stops the game when too few players are left after the time ends", () => {
        const { manager, code, ids, clock } = reconSetup(["ann", "bob"]);
        manager.startGame(code, ids[0]!, WORDS);
        manager.disconnect(code, ids[1]!);
        clock.now += 30_000;
        manager.tick();
        expect(manager.view(code)!.game).toBeNull();
        expect(manager.takeFinished()).toEqual([]);
    });

    it("keeps a room that only has players who are away, until they are removed", () => {
        const { manager, code, ids, clock } = reconSetup(["ann"]);
        manager.disconnect(code, ids[0]!);
        expect(manager.sweep()).toBe(0);
        clock.now += 30_000;
        manager.tick();
        expect(manager.view(code)!.players).toEqual([]);
    });
});
