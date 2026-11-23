import { describe, expect, it } from "vitest";
import { initialRoomState, roomReducer, type RoomState } from "./roomState";

const room = {
    code: "ABCDE",
    mode: "compete" as const,
    players: [{ id: "p1", name: "ann", isGuest: true, isHost: true }],
    game: null,
};

it("keeps the room when an error comes after the join", () => {
    let s = roomReducer(initialRoomState, {
        type: "message",
        message: { type: "room_state", room },
    });
    s = roomReducer(s, {
        type: "message",
        message: {
            type: "error",
            code: "not_host",
            message: "Only the host can start the game",
        },
    });
    expect(s).toMatchObject({
        status: "joined",
        error: "Only the host can start the game",
    });
    // The next room state clears the notice
    s = roomReducer(s, {
        type: "message",
        message: { type: "room_state", room },
    });
    expect(s.error).toBeNull();
});

describe("roomReducer", () => {
    it("starts in the connecting state", () => {
        expect(initialRoomState.status).toBe("connecting");
    });

    it("stores the player id from the welcome message", () => {
        const s = roomReducer(initialRoomState, {
            type: "message",
            message: { type: "welcome", playerId: "p1" },
        });
        expect(s.playerId).toBe("p1");
    });

    it("shows the room after a room_state message", () => {
        const s = roomReducer(initialRoomState, {
            type: "message",
            message: { type: "room_state", room },
        });
        expect(s).toMatchObject({ status: "joined", room });
    });

    it("keeps an error message when the socket closes after it", () => {
        let s: RoomState = roomReducer(initialRoomState, {
            type: "message",
            message: {
                type: "error",
                code: "room_full",
                message: "That room is full",
            },
        });
        s = roomReducer(s, { type: "socket_closed" });
        expect(s).toMatchObject({
            status: "error",
            error: "That room is full",
        });
    });

    it("marks a joined room as closed when the socket closes", () => {
        let s = roomReducer(initialRoomState, {
            type: "message",
            message: { type: "room_state", room },
        });
        s = roomReducer(s, { type: "socket_closed" });
        expect(s.status).toBe("closed");
    });

    it("clears the room after the player leaves", () => {
        let s = roomReducer(initialRoomState, {
            type: "message",
            message: { type: "room_state", room },
        });
        s = roomReducer(s, { type: "message", message: { type: "left" } });
        expect(s).toMatchObject({ status: "closed", room: null });
    });

    it("resets on a new connection", () => {
        let s = roomReducer(initialRoomState, {
            type: "message",
            message: { type: "room_state", room },
        });
        s = roomReducer(s, { type: "connecting" });
        expect(s).toEqual(initialRoomState);
    });
});
