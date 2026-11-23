import { randomInt, randomUUID } from "node:crypto";
import {
    MAX_PLAYERS,
    ROOM_CODE_ALPHABET,
    type GameView,
    type Mode,
    type RoomView,
    type Stroke,
    type StrokeChunk,
} from "../protocol.js";
import { buildOrder, maskWord, nextTurn } from "./rules.js";
import { applyChunk, undoLast } from "../canvas.js";

export interface Player {
    id: string;
    name: string;
    /** account id is null for guests */
    userId: number | null;
}

interface Game {
    order: string[];
    words: string[];
    turn: number;
    phase: "drawing" | "reveal";
    endsAt: number;
    // Current drawing
    strokes: Stroke[];
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
    game: Game | null;
}

export type StartError =
    | "room_not_found"
    | "not_host"
    | "game_running"
    | "not_enough_players";
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
    rounds?: number;
    minPlayers?: number;
    drawMs?: number;
    revealMs?: number;
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
    private rounds: number;
    private minPlayers: number;
    private drawMs: number;
    private revealMs: number;
    private now: () => number;
    private makeCode: () => string;

    constructor(opts: RoomManagerOptions = {}) {
        this.maxRooms = opts.maxRooms ?? 200;
        this.maxPlayers = opts.maxPlayers ?? MAX_PLAYERS;
        this.unusedTtlMs = opts.unusedTtlMs ?? 10 * 60 * 1000;
        this.emptyTtlMs = opts.emptyTtlMs ?? 60 * 1000;
        this.rounds = opts.rounds ?? 2;
        this.minPlayers = opts.minPlayers ?? 2;
        this.drawMs = opts.drawMs ?? 60_000;
        this.revealMs = opts.revealMs ?? 5_000;
        this.now = opts.now ?? Date.now;
        this.makeCode = opts.makeCode ?? randomCode;
    }

    get size(): number {
        return this.rooms.size;
    }

    get wordsNeeded(): number {
        return this.maxPlayers * this.rounds;
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
            game: null,
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
        this.afterLeave(room, playerId);
        return this.toView(room);
    }

    /** Check that this player can start a game now */
    startError(code: string, playerId: string): StartError | null {
        const room = this.rooms.get(code);
        if (!room) return "room_not_found";
        if (room.hostId !== playerId) return "not_host";
        if (room.game) return "game_running";
        if (room.players.size < this.minPlayers) return "not_enough_players";
        return null;
    }

    startGame(
        code: string,
        playerId: string,
        words: string[],
    ): { ok: true } | { ok: false; error: StartError } {
        const error = this.startError(code, playerId);
        if (error) return { ok: false, error };
        const room = this.rooms.get(code)!;
        const order = buildOrder([...room.players.keys()], this.rounds).slice(
            0,
            words.length,
        );
        if (order.length === 0)
            return { ok: false, error: "not_enough_players" };
        room.game = {
            order,
            words,
            turn: 0,
            phase: "drawing",
            endsAt: this.now() + this.drawMs,
            strokes: [],
        };
        return { ok: true };
    }

    /** Move game forwards when a timer ends */
    tick(): string[] {
        const now = this.now();
        const changed: string[] = [];
        for (const room of this.rooms.values()) {
            const game = room.game;
            if (!game || now < game.endsAt) continue;
            if (game.phase === "drawing") {
                game.phase = "reveal";
                game.endsAt = now + this.revealMs;
            } else {
                const next = nextTurn(
                    game.order,
                    game.turn,
                    new Set(room.players.keys()),
                );
                if (next === null) {
                    room.game = null;
                } else {
                    game.turn = next;
                    game.strokes = [];
                    game.phase = "drawing";
                    game.endsAt = now + this.drawMs;
                }
            }
            changed.push(room.code);
        }
        return changed;
    }

    private gameForDrawer(code: string, playerId: string): Game | null {
        const game = this.rooms.get(code)?.game;
        if (
            !game ||
            game.phase !== "drawing" ||
            game.order[game.turn] !== playerId
        )
            return null;
        return game;
    }

    draw(
        code: string,
        playerId: string,
        chunk: StrokeChunk,
    ):
        | { ok: true; chunk: StrokeChunk }
        | { ok: false; error: "not_drawer" | "canvas_limit" } {
        const game = this.gameForDrawer(code, playerId);
        if (!game) return { ok: false, error: "not_drawer" };
        const result = applyChunk(game.strokes, chunk);
        if (!result) return { ok: false, error: "canvas_limit" };
        game.strokes = result.strokes;
        return { ok: true, chunk: result.chunk };
    }

    undoStroke(code: string, playerId: string): boolean {
        const game = this.gameForDrawer(code, playerId);
        if (!game) return false;
        game.strokes = undoLast(game.strokes);
        return true;
    }

    clearCanvas(code: string, playerId: string): boolean {
        const game = this.gameForDrawer(code, playerId);
        if (!game) return false;
        game.strokes = [];
        return true;
    }

    strokes(code: string): Stroke[] {
        return this.rooms.get(code)?.game?.strokes ?? [];
    }

    view(code: string, viewerId: string | null = null): RoomView | null {
        const room = this.rooms.get(code);
        return room ? this.toView(room, viewerId) : null;
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

    private afterLeave(room: Room, playerId: string) {
        const game = room.game;
        if (!game) return;
        if (room.players.size < this.minPlayers) {
            room.game = null;
        } else if (
            game.phase === "drawing" &&
            game.order[game.turn] === playerId
        ) {
            game.phase = "reveal";
            game.endsAt = this.now() + this.revealMs;
        }
    }

    private gameView(game: Game, viewerId: string | null): GameView {
        const word = game.words[game.turn]!;
        const drawerId = game.order[game.turn]!;
        const canSee = game.phase === "reveal" || viewerId === drawerId;
        return {
            phase: game.phase,
            turn: game.turn + 1,
            totalTurns: game.order.length,
            drawerId,
            hint: maskWord(word),
            word: canSee ? word : null,
            msLeft: Math.max(0, game.endsAt - this.now()),
        };
    }

    private toView(room: Room, viewerId: string | null = null): RoomView {
        return {
            code: room.code,
            mode: room.mode,
            players: [...room.players.values()].map((p) => ({
                id: p.id,
                name: p.name,
                isGuest: p.userId === null,
                isHost: p.id === room.hostId,
            })),
            game: room.game ? this.gameView(room.game, viewerId) : null,
        };
    }
}
