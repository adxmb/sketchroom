import { useEffect, useReducer, useRef } from "react";
import {
    clientMessageSchema,
    type ClientMessage,
    type StrokeChunk,
} from "../../server/src/protocol";
import { initialRoomState, roomReducer } from "./roomState";

function socketUrl() {
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    return `${scheme}://${window.location.host}/ws`;
}

/** Open a WebSocket to a room */
export function useRoom(code: string, name: string | null) {
    const [state, dispatch] = useReducer(roomReducer, initialRoomState);
    const socketRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        dispatch({ type: "connecting" });
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
                dispatch({
                    type: "message",
                    message: JSON.parse(String(event.data)),
                });
            } catch {
                // Ignore non-JSON
            }
        };
        socket.onclose = () => dispatch({ type: "socket_closed" });

        return () => {
            socket.onclose = null;
            socket.close();
        };
    }, [code, name]);

    const sendMessage = (message: ClientMessage) => {
        if (clientMessageSchema.safeParse(message).success)
            socketRef.current?.send(JSON.stringify(message));
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
