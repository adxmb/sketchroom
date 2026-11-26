import { randomInt, randomUUID } from "node:crypto";
import { applyChunk, undoLast } from "../canvas.js";
import { applyOwned, clearOwned, undoOwned } from "../board.js";
import {
    MAX_PLAYERS,
    ROOM_CODE_ALPHABET,
    PLAYER_COLOURS,
    type ChatMessage,
    type GameView,
    type Mode,
    type ResultsView,
    type RoomView,
    type Stroke,
    type StrokeChunk,
    type OwnedStroke,
} from "../protocol.js";
import {
    buildOrder,
    drawerScore,
    guesserScore,
    isCloseGuess,
    isCorrectGuess,
    maskWord,
    nextTurn,
    rankPlayers,
} from "./rules.js";
import { fa } from "zod/locales";

export interface Player {
    id: string;
    name: string;
    /** account id is null for guests */
    userId: number | null;
    owner: string | null;
    connected: boolean;
    colour: number;
    disconnectedAt: number | null;
}

interface Game {
    order: string[];
    words: string[];
    turn: number;
    phase: "drawing" | "reveal";
    endsAt: number;
    // Current drawing
    strokes: Stroke[];
    scores: Map<string, number>;
    guessed: Set<string>;
}

/** A game that ended. The caller saves it for the accounts in it */
export interface FinishedGame {
    code: string;
    rounds: number;
    players: {
        userId: number | null;
        name: string;
        score: number;
        rank: number;
    }[];
}

/** A message and the players who get it */
export interface ChatDelivery {
    to: "all" | string[];
    message: ChatMessage;
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
    lastResults: ResultsView | null;
    board: OwnedStroke[];
}

export type StartError =
    | "room_not_found"
    | "wrong_mode"
    | "not_host"
    | "game_running"
    | "not_enough_players";
export type JoinError = "room_not_found" | "room_full" | "name_taken";
export type JoinResult =
    | { ok: true; player: Player; room: RoomView; resumed: boolean }
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
    reconnectMs?: number;
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
    private finished: FinishedGame[] = [];
    private maxRooms: number;
    private maxPlayers: number;
    private unusedTtlMs: number;
    private emptyTtlMs: number;
    private rounds: number;
    private minPlayers: number;
    private drawMs: number;
    private revealMs: number;
    private reconnectMs: number;
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
        this.reconnectMs = opts.reconnectMs ?? 30_000;
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
            lastResults: null,
            board: [],
        });
        return { ok: true, code };
    }

    join(
        code: string,
        who: { name: string; userId: number | null; owner?: string | null },
    ): JoinResult {
        const room = this.rooms.get(code);
        if (!room) return { ok: false, error: "room_not_found" };
        const owner = who.owner ?? null;
        const same = [...room.players.values()].find(
            (p) => p.name.toLowerCase() === who.name.toLowerCase(),
        );
        if (same) {
            if (owner === null || same.owner !== owner)
                return { ok: false, error: "name_taken" };
            same.connected = true;
            same.disconnectedAt = null;
            room.emptySince = null;
            return {
                ok: true,
                player: same,
                room: this.toView(room),
                resumed: true,
            };
        }
        if (room.players.size >= this.maxPlayers)
            return { ok: false, error: "room_full" };

        const player: Player = {
            id: randomUUID(),
            name: who.name,
            userId: who.userId,
            owner,
            connected: true,
            colour: this.freeColour(room),
            disconnectedAt: null,
        };
        room.players.set(player.id, player);
        room.hostId ??= player.id;
        room.everJoined = true;
        room.emptySince = null;
        return { ok: true, player, room: this.toView(room), resumed: false };
    }

    disconnect(code: string, playerId: string): RoomView | null {
        const room = this.rooms.get(code);
        const player = room?.players.get(playerId);
        if (!room || !player) return room ? this.toView(room) : null;
        if (player.owner === null) return this.leave(code, playerId);
        player.connected = false;
        player.disconnectedAt = this.now();
        const game = room.game;
        // The guessers who are still here may all have the word already
        if (game && game.phase === "drawing" && this.allGuessed(room, game))
            this.endTurn(room, game, true);
        return this.toView(room);
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
        if (room.mode !== "compete") return "wrong_mode";
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
        room.lastResults = null;
        room.game = {
            order,
            words,
            turn: 0,
            phase: "drawing",
            endsAt: this.now() + this.drawMs,
            strokes: [],
            scores: new Map(),
            guessed: new Set(),
        };
        return { ok: true };
    }

    /** Move game forwards when a timer ends */
    tick(): string[] {
        const now = this.now();
        const changed = new Set<string>();
        for (const room of this.rooms.values()) {
            // A player who did not come back in time leaves now
            for (const p of [...room.players.values()]) {
                if (
                    !p.connected &&
                    p.disconnectedAt !== null &&
                    now - p.disconnectedAt >= this.reconnectMs
                ) {
                    this.leave(room.code, p.id);
                    changed.add(room.code);
                }
            }
            const game = room.game;
            if (!game || now < game.endsAt) continue;
            if (game.phase === "drawing") {
                this.endTurn(room, game, true);
            } else {
                const next = nextTurn(
                    game.order,
                    game.turn,
                    new Set(room.players.keys()),
                );
                if (next === null) {
                    this.finishGame(room, game);
                } else {
                    game.turn = next;
                    game.strokes = [];
                    game.guessed = new Set();
                    game.phase = "drawing";
                    game.endsAt = now + this.drawMs;
                }
            }
            changed.add(room.code);
        }
        return [...changed];
    }

    /** Games that ended since the last call. The caller saves them */
    takeFinished(): FinishedGame[] {
        return this.finished.splice(0);
    }

    /**
     * A chat message. In the drawing phase, a message from a guesser is a guess.
     * Return who gets which message, and if the room state changed. null if the player is not in the room.
     */
    chat(
        code: string,
        playerId: string,
        text: string,
    ): { deliveries: ChatDelivery[]; stateChanged: boolean } | null {
        const room = this.rooms.get(code);
        const player = room?.players.get(playerId);
        if (!room || !player) return null;
        const game = room.game;
        const base = { playerId, name: player.name };

        if (!game || game.phase !== "drawing") {
            const message: ChatMessage = {
                ...base,
                kind: "chat",
                text,
                knowsWord: false,
            };
            return {
                deliveries: [{ to: "all", message }],
                stateChanged: false,
            };
        }

        const drawerId = game.order[game.turn]!;
        const word = game.words[game.turn]!;

        if (playerId === drawerId || game.guessed.has(playerId)) {
            // This player knows the word. The others must not read the text, as it can give the word away
            const to = [drawerId, ...game.guessed].filter((id) =>
                room.players.has(id),
            );
            const message: ChatMessage = {
                ...base,
                kind: "chat",
                text,
                knowsWord: true,
            };
            return { deliveries: [{ to, message }], stateChanged: false };
        }

        if (isCorrectGuess(text, word)) {
            const msLeft = Math.max(0, game.endsAt - this.now());
            game.scores.set(
                playerId,
                (game.scores.get(playerId) ?? 0) +
                    guesserScore(msLeft, this.drawMs),
            );
            game.guessed.add(playerId);
            if (this.allGuessed(room, game)) this.endTurn(room, game, true);
            // The text is not sent, so the word stays secret
            const message: ChatMessage = {
                ...base,
                kind: "guessed",
                text: "",
                knowsWord: false,
            };
            return { deliveries: [{ to: "all", message }], stateChanged: true };
        }

        const deliveries: ChatDelivery[] = [
            {
                to: "all",
                message: { ...base, kind: "chat", text, knowsWord: false },
            },
        ];
        if (isCloseGuess(text, word)) {
            deliveries.push({
                to: [playerId],
                message: { ...base, kind: "close", text: "", knowsWord: false },
            });
        }
        return { deliveries, stateChanged: false };
    }

    /** True if every player except the drawer found the word */
    private allGuessed(room: Room, game: Game): boolean {
        const drawerId = game.order[game.turn];
        let guessers = 0;
        for (const p of room.players.values()) {
            if (p.id === drawerId || !p.connected) continue;
            guessers++;
            if (!game.guessed.has(p.id)) return false;
        }
        return guessers > 0;
    }

    /** End the time to draw. The drawer gets points for the guessers, except when the drawer left */
    private endTurn(room: Room, game: Game, awardDrawer: boolean) {
        const drawerId = game.order[game.turn]!;
        if (awardDrawer && room.players.has(drawerId)) {
            const guessers = room.players.size - 1;
            const correct = [...game.guessed].filter((id) =>
                room.players.has(id),
            ).length;
            game.scores.set(
                drawerId,
                (game.scores.get(drawerId) ?? 0) +
                    drawerScore(correct, guessers),
            );
        }
        game.phase = "reveal";
        game.endsAt = this.now() + this.revealMs;
    }

    /** The last turn is over. Keep the results for the end screen and for the database */
    private finishGame(room: Room, game: Game) {
        const ranked = rankPlayers(
            [...room.players.values()].map((p) => ({
                name: p.name,
                userId: p.userId,
                score: game.scores.get(p.id) ?? 0,
            })),
        );
        room.lastResults = {
            players: ranked.map((p) => ({
                name: p.name,
                score: p.score,
                rank: p.rank,
                isGuest: p.userId === null,
            })),
        };
        this.finished.push({
            code: room.code,
            rounds: this.rounds,
            players: ranked.map((p) => ({
                userId: p.userId,
                name: p.name,
                score: p.score,
                rank: p.rank,
            })),
        });
        room.game = null;
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

    hasSharedBoard(code: string): boolean {
        return this.rooms.get(code)?.mode === "collab";
    }

    boardDraw(
        code: string,
        playerId: string,
        chunk: StrokeChunk,
    ):
        | { ok: true; chunk: StrokeChunk }
        | { ok: false; error: "wrong_mode" | "not_in_room" | "canvas_limit" } {
        const room = this.rooms.get(code);
        if (!room || !room.players.has(playerId))
            return { ok: false, error: "not_in_room" };
        if (room.mode !== "collab") return { ok: false, error: "wrong_mode" };
        const result = applyOwned(room.board, playerId, chunk);
        if (!result) return { ok: false, error: "canvas_limit" };
        room.board = result.strokes;
        return { ok: true, chunk: result.chunk };
    }

    boardUndo(code: string, playerId: string): boolean {
        const room = this.rooms.get(code);
        if (!room || room.mode !== "collab" || !room.players.has(playerId))
            return false;
        room.board = undoOwned(room.board, playerId);
        return true;
    }

    boardClear(code: string, playerId: string): boolean {
        const room = this.rooms.get(code);
        if (!room || room.mode !== "collab" || !room.players.has(playerId))
            return false;
        room.board = clearOwned(room.board, playerId);
        return true;
    }

    board(code: string): OwnedStroke[] {
        return this.rooms.get(code)?.board ?? [];
    }

    private freeColour(room: Room): number {
        const used = new Set([...room.players.values()].map((p) => p.colour));
        for (let i = 0; i < PLAYER_COLOURS.length; i++)
            if (!used.has(i)) return i;
        return room.players.size % PLAYER_COLOURS.length;
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
        game.scores.delete(playerId);
        game.guessed.delete(playerId);
        if (room.players.size < this.minPlayers) {
            // Not enough players to go on. The game does not count
            room.game = null;
            room.lastResults = null;
        } else if (game.phase === "drawing") {
            if (game.order[game.turn] === playerId) {
                // The drawer left. End the turn now. There are no points for the drawer
                this.endTurn(room, game, false);
            } else if (this.allGuessed(room, game)) {
                // The only guessers who are left already found the word
                this.endTurn(room, game, true);
            }
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
                score: room.game?.scores.get(p.id) ?? 0,
                guessed: room.game?.guessed.has(p.id) ?? false,
                connected: p.connected,
                colour: p.colour,
            })),
            game: room.game ? this.gameView(room.game, viewerId) : null,
            results: room.lastResults,
        };
    }
}
