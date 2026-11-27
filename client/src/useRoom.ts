import { useEffect, useReducer, useRef } from "react";
import {
    clientMessageSchema,
    type ClientMessage,
    type StrokeChunk,
} from "../../server/src/protocol";
import { api } from "./api";
import { initialRoomState, roomReducer } from "./roomState";

function socketUrl() {
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    return `${scheme}://${window.location.host}/ws`;
}

/** Wait this long before each new try. The server keeps the seat for 30 seconds, so five tries fit */
export const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000];

const NO_RETRY_CODES = [1008, 4000];

export function useRoom(code: string, name: string | null) {
    const [state, dispatch] = useReducer(roomReducer, initialRoomState);
    const socketRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        let stopped = false;
        let joined = false;
        let attempt = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        dispatch({ type: "connecting" });

        const open = () => {
            const socket = new WebSocket(socketUrl());
            socketRef.current = socket;

            socket.onopen = () => {
                const join: ClientMessage = {
                    type: "join_room",
                    code,
                    ...(name ? { name } : {}),
                };
                socket.send(JSON.stringify(join));
            };
            socket.onmessage = (event) => {
                try {
                    const message = JSON.parse(String(event.data));
                    if (message.type === "welcome") {
                        joined = true;
                        attempt = 0;
                    }
                    if (message.type === "left") stopped = true;
                    dispatch({ type: "message", message });
                } catch {
                    // Ignore not JSON
                }
            };
            socket.onclose = (event) => {
                if (stopped) return;
                const delay = RETRY_DELAYS_MS[attempt];
                if (
                    !joined ||
                    NO_RETRY_CODES.includes(event.code) ||
                    delay === undefined
                ) {
                    dispatch({ type: "socket_closed" });
                    return;
                }
                attempt++;
                dispatch({ type: "reconnecting" });
                timer = setTimeout(open, delay);
            };
        };

        api.guest().finally(() => {
            if (!stopped) open();
        });

        return () => {
            stopped = true;
            clearTimeout(timer);
            const socket = socketRef.current;
            if (socket) {
                socket.onclose = null;
                socket.close();
            }
        };
    }, [code, name]);

    const sendMessage = (message: ClientMessage) => {
        const socket = socketRef.current;
        if (
            socket?.readyState === WebSocket.OPEN &&
            clientMessageSchema.safeParse(message).success
        ) {
            socket.send(JSON.stringify(message));
        }
    };

    return {
        state,
        leave: () => sendMessage({ type: "leave_room" }),
        startGame: () => sendMessage({ type: "start_game" }),
        sendChat: (text: string) => sendMessage({ type: "chat", text }),
        drawLocal: (chunk: StrokeChunk) =>
            dispatch({ type: "local_chunk", chunk }),
        drawSend: (stroke: StrokeChunk) =>
            sendMessage({ type: "draw", stroke }),
        boardLocal: (chunk: StrokeChunk) =>
            dispatch({ type: "local_board_chunk", chunk }),
        boardUndo: () => {
            dispatch({ type: "local_board_undo" });
            sendMessage({ type: "undo_stroke" });
        },
        boardClear: () => {
            dispatch({ type: "local_board_clear" });
            sendMessage({ type: "clear_canvas" });
        },
        sendCursor: (x: number, y: number) =>
            sendMessage({ type: "cursor", x, y }),
        undo: () => {
            dispatch({ type: "local_undo" });
            sendMessage({ type: "undo_stroke" });
        },
        clearCanvas: () => {
            dispatch({ type: "local_clear" });
            sendMessage({ type: "clear_canvas" });
        },
    };
}
