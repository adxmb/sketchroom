import type { RoomView, ServerMessage } from "../../server/src/protocol";

export type RoomStatus = "connecting" | "joined" | "error" | "closed";

export interface RoomState {
    status: RoomStatus;
    playerId: string | null;
    room: RoomView | null;
    error: string | null;
}

export type RoomEvent =
    | { type: "connecting" }
    | { type: "message"; message: ServerMessage }
    | { type: "socket_closed" };

export const initialRoomState: RoomState = {
    status: "connecting",
    playerId: null,
    room: null,
    error: null,
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
        case "message": {
            const msg = event.message;
            switch (msg.type) {
                case "welcome":
                    return { ...state, playerId: msg.playerId };
                case "room_state":
                    return {
                        ...state,
                        status: "joined",
                        room: msg.room,
                        error: null,
                    };
                case "left":
                    return { ...state, status: "closed", room: null };
                case "error":
                    return state.room
                        ? { ...state, error: msg.message }
                        : { ...state, status: "error", error: msg.message };
            }
        }
    }
}
