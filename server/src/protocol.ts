/**
 * The messages between browser and server, and the rules for names and room codes
 * The client imports this file too. It must not import anything except zod
 */
import { z } from "zod";

export const MAX_PLAYERS = 8;

/** Rule for usernames and guest names */
export const usernameSchema = z
    .string()
    .min(3, "Username must have 3 to 20 characters")
    .max(20, "Username must have 3 to 20 characters")
    .regex(
        /^[A-Za-z0-9_]+$/,
        "Username can use only letters, numbers and underscores",
    );

/** Five characters. No I, O, 0 or 1, since people confuse them */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const roomCodeSchema = z
    .string()
    .regex(/^[A-HJ-NP-Z2-9]{5}$/, "Invalid room code");

export const chatTextSchema = z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(
        /^[^\u0000-\u001f\u007f]*$/,
        "Text has characted that are not allowed",
    );

export const modeSchema = z.enum(["compete", "collab"]);
export type Mode = z.infer<typeof modeSchema>;

export const createRoomSchema = z.object({ mode: modeSchema });

// ------- Drawing --------

/** The size of the board */
export const CANVAS_WIDTH = 800;
export const CANVAS_HEIGHT = 600;
/** Colours, by index */
export const PALETTE = [
    "#111827",
    "#dc2626",
    "#ea580c",
    "#16a34a",
    "#2563eb",
    "#9333ea",
    "#ffffff",
] as const;
/** Brush widths */
export const BRUSH_SIZES = [4, 10, 22] as const;
export const MAX_POINTS_PER_CHUNK = 50;
export const pointSchema = z.tuple([
    z.number().int().min(0).max(CANVAS_WIDTH),
    z.number().int().min(0).max(CANVAS_HEIGHT),
]);
export type Point = z.infer<typeof pointSchema>;

/** A stroke is a lone from pen down pos to pen up pos */
export const strokeChunkSchema = z.object({
    id: z.number().int().min(0).max(1_000_000),
    colour: z
        .number()
        .int()
        .min(0)
        .max(PALETTE.length - 1),
    size: z
        .number()
        .int()
        .min(0)
        .max(BRUSH_SIZES.length - 1),
    points: z.array(pointSchema).min(1).max(MAX_POINTS_PER_CHUNK),
    done: z.boolean().optional(),
});
export type StrokeChunk = z.infer<typeof strokeChunkSchema>;

export interface Stroke {
    id: number;
    colour: number;
    size: number;
    points: Point[];
    done: boolean;
}

// ------- Client to server --------

export const clientMessageSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("join_room"),
        code: roomCodeSchema,
        name: usernameSchema.optional(),
    }),
    z.object({ type: z.literal("leave_room") }),
    z.object({ type: z.literal("start_game") }),
    z.object({ type: z.literal("draw"), stroke: strokeChunkSchema }),
    z.object({ type: z.literal("undo_stroke") }),
    z.object({ type: z.literal("clear_canvas") }),
    z.object({ type: z.literal("chat"), text: chatTextSchema }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ------- Server to client --------

export interface PlayerView {
    id: string;
    name: string;
    isGuest: boolean;
    isHost: boolean;
    score: number;
    guessed: boolean;
}

export interface ChatMessage {
    kind: "chat" | "guessed" | "close";
    playerId: string;
    name: string;
    text: string;
    knowsWord: boolean;
}

export interface ResultsView {
    players: { name: string; score: number; rank: number; isGuest: boolean }[];
}

export interface GameView {
    phase: "drawing" | "reveal";
    turn: number;
    totalTurns: number;
    drawerId: string;
    hint: string;
    word: string | null;
    msLeft: number;
}

export interface RoomView {
    code: string;
    mode: Mode;
    players: PlayerView[];
    // Null while in lobby
    game: GameView | null;
    results: ResultsView | null;
}

export type ErrorCode =
    | "bad_message"
    | "room_not_found"
    | "room_full"
    | "name_taken"
    | "name_reserved"
    | "name_required"
    | "already_joined"
    | "not_in_room"
    | "not_host"
    | "not_enough_players"
    | "game_running"
    | "not_drawer"
    | "canvas_limit"
    | "server_error"
    | "rate_limited";

export type ServerMessage =
    | { type: "welcome"; playerId: string }
    | { type: "room_state"; room: RoomView }
    | { type: "draw"; stroke: StrokeChunk }
    | { type: "canvas"; strokes: Stroke[] }
    | { type: "left" }
    | { type: "chat"; message: ChatMessage }
    | { type: "error"; code: ErrorCode; message: string };

// ---- Scores (REST, not WebSocket) ----

export interface Stats {
    games: number;
    wins: number;
    bestScore: number;
    totalScore: number;
}

export interface LeaderboardRow {
    username: string;
    totalScore: number;
    games: number;
    wins: number;
}
