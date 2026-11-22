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

export const modeSchema = z.enum(["compete", "collab"]);
export type Mode = z.infer<typeof modeSchema>;

export const createRoomSchema = z.object({ mode: modeSchema });

// ------- Client to server --------
export const clientMessageSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("join_room"),
        code: roomCodeSchema,
        name: usernameSchema.optional(),
    }),
    z.object({ type: z.literal("leave_room") }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ------- Server to client --------
export interface PlayerView {
    id: string;
    name: string;
    isGuest: boolean;
    isHost: boolean;
}

export interface RoomView {
    code: string;
    mode: Mode;
    players: PlayerView[];
}

export type ErrorCode =
    | "bad_message"
    | "room_not_found"
    | "room_full"
    | "name_taken"
    | "name_reserved"
    | "name_required"
    | "already_joined"
    | "rate_limited";

export type ServerMessage =
    | { type: "welcome"; playerId: string }
    | { type: "room_state"; room: RoomView }
    | { type: "left" }
    | { type: "error"; code: ErrorCode; message: string };
