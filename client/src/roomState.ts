import type {
    RoomView,
    ServerMessage,
    Stroke,
    StrokeChunk,
} from "../../server/src/protocol";
import { applyChunk, undoLast } from "../../server/src/canvas";

export type RoomStatus = "connecting" | "joined" | "error" | "closed";

export interface RoomState {
    status: RoomStatus;
    playerId: string | null;
    room: RoomView | null;
    error: string | null;
    strokes: Stroke[];
}

export type RoomEvent =
    | { type: "connecting" }
    | { type: "message"; message: ServerMessage }
    | { type: "socket_closed" }
    | { type: "local_chunk"; chunk: StrokeChunk }
    | { type: "local_undo" }
    | { type: "local_clear" };

export const initialRoomState: RoomState = {
    status: "connecting",
    playerId: null,
    room: null,
    error: null,
    strokes: [],
};

/** One function decides how every event changes the screen */
export function roomReducer(state: RoomState, event: RoomEvent): RoomState {
    switch (event.type) {
        case "connecting":
            return initialRoomState;
        case "socket_closed":
            return state.status === "error"
                ? state
                : { ...state, status: "closed" };
        case "local_chunk":
            return {
                ...state,
                strokes:
                    applyChunk(state.strokes, event.chunk)?.strokes ??
                    state.strokes,
            };
        case "local_undo":
            return {
                ...state,
                strokes: undoLast(state.strokes),
            };
        case "local_clear":
            return {
                ...state,
                strokes: [],
            };
        case "message": {
            const msg = event.message;
            switch (msg.type) {
                case "welcome":
                    return { ...state, playerId: msg.playerId };
                case "room_state":
                    const sameTurn =
                        state.room?.game &&
                        msg.room.game &&
                        state.room.game.turn === msg.room.game.turn;
                    return {
                        ...state,
                        status: "joined",
                        room: msg.room,
                        error: null,
                        strokes: sameTurn ? state.strokes : [],
                    };
                case "draw":
                    return {
                        ...state,
                        strokes:
                            applyChunk(state.strokes, msg.stroke)?.strokes ??
                            state.strokes,
                    };
                case "canvas":
                    return { ...state, strokes: msg.strokes };
                case "left":
                    return { ...state, status: "closed", room: null };
                case "error":
                    if (msg.code === "not_drawer") return state;
                    return state.room
                        ? { ...state, error: msg.message }
                        : { ...state, status: "error", error: msg.message };
            }
        }
    }
}
