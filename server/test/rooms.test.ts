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
