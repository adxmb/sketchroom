import { randomInt, randomUUID } from "node:crypto";
import {
    MAX_PLAYERS,
    ROOM_CODE_ALPHABET,
    type Mode,
    type RoomView,
} from "../protocol.js";

export interface Player {
    id: string;
    name: string;
    /** account id is null for guests */
    userId: number | null;
}

interface Room {
    code: string;
    mode: Mode;
    hostId: string | null;
    players: Map<string, Player>;
    createdAt: number;
    everJoined: boolean;
    /** When the final player leaves, null if still occupied */
    emptySince: number | null;
}

export type JoinError = "room_not_found" | "room_full" | "name_taken";
export type JoinResult =
    | { ok: true; player: Player; room: RoomView }
    | { ok: false; error: JoinError };

export interface RoomManagerOptions {
    maxRooms?: number;
    maxPlayers?: number;
    /** A room that nobody joing is removed after this time */
    unusedTtlMs?: number;
    /** A room that is empty is removed after this time */
    emptyTtlMs?: number;
    now?: () => number;
    makeCode?: () => string;
}

function randomCode(): string {
    let code = "";
    for (let i = 0; i < 5; i++)
        code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    return code;
}

/**
 * Manages all live rooms
 */
export class RoomManager {
    private rooms = new Map<string, Room>();
    private maxRooms: number;
    private maxPlayers: number;
    private unusedTtlMs: number;
    private emptyTtlMs: number;
    private now: () => number;
    private makeCode: () => string;

    constructor(opts: RoomManagerOptions = {}) {
        this.maxRooms = opts.maxRooms ?? 200;
        this.maxPlayers = opts.maxPlayers ?? MAX_PLAYERS;
        this.unusedTtlMs = opts.unusedTtlMs ?? 10 * 60 * 1000;
        this.emptyTtlMs = opts.emptyTtlMs ?? 60 * 1000;
        this.now = opts.now ?? Date.now;
        this.makeCode = opts.makeCode ?? randomCode;
    }

    get size(): number {
        return this.rooms.size;
    }

    createRoom(
        mode: Mode,
    ): { ok: true; code: string } | { ok: false; error: "too_many_rooms" } {
        if (this.rooms.size >= this.maxRooms)
            return { ok: false, error: "too_many_rooms" };
        let code = this.makeCode();
        for (let i = 0; this.rooms.has(code); i++) {
            if (i > 20) return { ok: false, error: "too_many_rooms" };
            code = this.makeCode();
        }
        this.rooms.set(code, {
            code,
            mode,
            hostId: null,
            players: new Map(),
            createdAt: this.now(),
            everJoined: false,
            emptySince: null,
        });
        return { ok: true, code };
    }

    join(
        code: string,
        who: { name: string; userId: number | null },
    ): JoinResult {
        const room = this.rooms.get(code);
        if (!room) return { ok: false, error: "room_not_found" };
        if (room.players.size >= this.maxPlayers)
            return { ok: false, error: "room_full" };
        const taken = [...room.players.values()].some(
            (p) => p.name.toLowerCase() === who.name.toLowerCase(),
        );
        if (taken) return { ok: false, error: "name_taken" };

        const player: Player = {
            id: randomUUID(),
            name: who.name,
            userId: who.userId,
        };
        room.players.set(player.id, player);
        room.hostId ??= player.id;
        room.everJoined = true;
        room.emptySince = null;
        return { ok: true, player, room: this.toView(room) };
    }

    /** Remove a player */
    leave(code: string, playerId: string): RoomView | null {
        const room = this.rooms.get(code);
        if (!room) return null;
        if (!room.players.delete(playerId)) return this.toView(room);
        if (room.players.size === 0) {
            // Keep room for short time
            room.hostId = null;
            room.emptySince = this.now();
        } else if (room.hostId === playerId) {
            // First player joining of those remaining is host
            room.hostId = room.players.keys().next().value ?? null;
        }
        return this.toView(room);
    }

    view(code: string): RoomView | null {
        const room = this.rooms.get(code);
        return room ? this.toView(room) : null;
    }

    /** Remove empty rooms */
    sweep(): number {
        let removed = 0;
        for (const [code, room] of this.rooms) {
            if (room.players.size > 0) continue;
            const since = room.emptySince ?? room.createdAt;
            const limit = room.everJoined ? this.emptyTtlMs : this.unusedTtlMs;
            if (this.now() - since > limit) {
                this.rooms.delete(code);
                removed++;
            }
        }
        return removed;
    }

    private toView(room: Room): RoomView {
        return {
            code: room.code,
            mode: room.mode,
            players: [...room.players.values()].map((p) => ({
                id: p.id,
                name: p.name,
                isGuest: p.userId === null,
                isHost: p.id === room.hostId,
            })),
        };
    }
}
