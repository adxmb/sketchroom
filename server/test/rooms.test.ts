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
