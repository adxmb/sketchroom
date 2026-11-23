import { applyChunk, undoLast } from "../../server/src/canvas";
import type {
    ChatMessage,
    RoomView,
    ServerMessage,
    Stroke,
    StrokeChunk,
} from "../../server/src/protocol";

export type RoomStatus = "connecting" | "joined" | "error" | "closed";

/** A chat message with a key for the list on the screen */
export type ChatEntry = ChatMessage & { key: number };

/** The list keeps this many messages. Older ones are dropped */
export const MAX_CHAT = 100;

export interface RoomState {
    status: RoomStatus;
    playerId: string | null;
    room: RoomView | null;
    error: string | null;
    /** The drawing of the current turn */
    strokes: Stroke[];
    chat: ChatEntry[];
    /** The key for the next chat message */
    chatSeq: number;
}

export type RoomEvent =
    | { type: "connecting" }
    | { type: "message"; message: ServerMessage }
    | { type: "socket_closed" }
    // The drawer changes the drawing here at once. The server does not send it back
    | { type: "local_chunk"; chunk: StrokeChunk }
    | { type: "local_undo" }
    | { type: "local_clear" };

export const initialRoomState: RoomState = {
    status: "connecting",
    playerId: null,
    room: null,
    error: null,
    strokes: [],
    chat: [],
    chatSeq: 0,
};

/** One function decides how every event changes the screen. Tests can run it directly */
export function roomReducer(state: RoomState, event: RoomEvent): RoomState {
    switch (event.type) {
        case "connecting":
            return initialRoomState;
        case "socket_closed":
            // An error message stays on screen. It explains why the connection closed
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
            return { ...state, strokes: undoLast(state.strokes) };
        case "local_clear":
            return { ...state, strokes: [] };
        case "message": {
            const m = event.message;
            switch (m.type) {
                case "welcome":
                    return { ...state, playerId: m.playerId };
                case "room_state": {
                    // A new turn, or no game, starts with an empty drawing
                    const sameTurn =
                        state.room?.game &&
                        m.room.game &&
                        state.room.game.turn === m.room.game.turn;
                    return {
                        ...state,
                        status: "joined",
                        room: m.room,
                        error: null,
                        strokes: sameTurn ? state.strokes : [],
                    };
                }
                case "draw":
                    return {
                        ...state,
                        strokes:
                            applyChunk(state.strokes, m.stroke)?.strokes ??
                            state.strokes,
                    };
                case "canvas":
                    return { ...state, strokes: m.strokes };
                case "chat":
                    return {
                        ...state,
                        chat: [
                            ...state.chat,
                            { ...m.message, key: state.chatSeq },
                        ].slice(-MAX_CHAT),
                        chatSeq: state.chatSeq + 1,
                    };
                case "left":
                    return {
                        ...state,
                        status: "closed",
                        room: null,
                        strokes: [],
                        chat: [],
                    };
                case "error":
                    // The drawer can send a stroke just after the turn ended. This is not a problem
                    if (m.code === "not_drawer") return state;
                    // Before the join, an error ends the page. After the join, it is only a notice
                    return state.room
                        ? { ...state, error: m.message }
                        : { ...state, status: "error", error: m.message };
            }
        }
    }
}
