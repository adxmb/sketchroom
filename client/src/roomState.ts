import { applyOwned, clearOwned, undoOwned } from "../../server/src/board";
import { applyChunk, undoLast } from "../../server/src/canvas";
import type {
    ChatMessage,
    OwnedStroke,
    RoomView,
    ServerMessage,
    Stroke,
    StrokeChunk,
} from "../../server/src/protocol";

// reconnecting: the connection broke. The screen stays and the page tries again
export type RoomStatus =
    | "connecting"
    | "joined"
    | "reconnecting"
    | "error"
    | "closed";

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
    /** The shared board of a collab room. Every stroke has an owner */
    board: OwnedStroke[];
    /** Where the pointers of the other players are, by player id. Board units */
    cursors: Record<string, { x: number; y: number }>;
    chat: ChatEntry[];
    /** The key for the next chat message */
    chatSeq: number;
}

export type RoomEvent =
    | { type: "connecting" }
    | { type: "message"; message: ServerMessage }
    | { type: "socket_closed" }
    // The connection broke. The page keeps the room, the chat and the drawing, and tries again
    | { type: "reconnecting" }
    // The drawer changes the drawing here at once. The server does not send it back
    | { type: "local_chunk"; chunk: StrokeChunk }
    | { type: "local_undo" }
    | { type: "local_clear" }
    // The same on a shared board. The strokes belong to this player
    | { type: "local_board_chunk"; chunk: StrokeChunk }
    | { type: "local_board_undo" }
    | { type: "local_board_clear" };

export const initialRoomState: RoomState = {
    status: "connecting",
    playerId: null,
    room: null,
    error: null,
    strokes: [],
    board: [],
    cursors: {},
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
        case "reconnecting":
            return state.room
                ? { ...state, status: "reconnecting" }
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
        case "local_board_chunk": {
            if (!state.playerId) return state;
            return {
                ...state,
                board:
                    applyOwned(state.board, state.playerId, event.chunk)
                        ?.strokes ?? state.board,
            };
        }
        case "local_board_undo":
            return state.playerId
                ? { ...state, board: undoOwned(state.board, state.playerId) }
                : state;
        case "local_board_clear":
            return state.playerId
                ? { ...state, board: clearOwned(state.board, state.playerId) }
                : state;
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
                    // A pointer of a player who is gone or offline must not stay on the board
                    const here = new Set(
                        m.room.players
                            .filter((p) => p.connected)
                            .map((p) => p.id),
                    );
                    const cursors = Object.fromEntries(
                        Object.entries(state.cursors).filter(([id]) =>
                            here.has(id),
                        ),
                    );
                    return {
                        ...state,
                        status: "joined",
                        room: m.room,
                        error: null,
                        strokes: sameTurn ? state.strokes : [],
                        cursors,
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
                case "board_draw":
                    return {
                        ...state,
                        board:
                            applyOwned(state.board, m.owner, m.stroke)
                                ?.strokes ?? state.board,
                    };
                case "board":
                    return { ...state, board: m.strokes };
                case "cursor":
                    return {
                        ...state,
                        cursors: {
                            ...state.cursors,
                            [m.playerId]: { x: m.x, y: m.y },
                        },
                    };
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
                        board: [],
                        cursors: {},
                        chat: [],
                    };
                case "error":
                    // The drawer can send a stroke just after the turn ended. This is not a problem
                    if (m.code === "not_drawer") return state;
                    // A join that fails while the page tries again (the room is gone, the name is taken) ends the page
                    if (state.status === "reconnecting")
                        return { ...state, status: "error", error: m.message };
                    // Before the join, an error ends the page. After the join, it is only a notice
                    return state.room
                        ? { ...state, error: m.message }
                        : { ...state, status: "error", error: m.message };
            }
        }
    }
}
