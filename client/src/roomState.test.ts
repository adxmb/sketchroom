import { describe, expect, it } from "vitest";
import { initialRoomState, roomReducer, type RoomState } from "./roomState";
import type { ServerMessage } from "../../server/src/protocol";

const room = {
    code: "ABCDE",
    mode: "compete" as const,
    players: [
        {
            id: "p1",
            name: "ann",
            isGuest: true,
            isHost: true,
            score: 0,
            guessed: false,
            connected: true,
            colour: 0,
        },
    ],
    game: null,
    results: null,
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
    describe("drawing", () => {
        const chunk = (id: number, extra = {}) => ({
            id,
            colour: 0,
            size: 0,
            points: [[1, 1]] as [number, number][],
            ...extra,
        });
        const inGame = (turn: number) => ({
            ...room,
            game: {
                phase: "drawing" as const,
                turn,
                totalTurns: 4,
                drawerId: "p1",
                hint: "_____",
                word: null,
                msLeft: 1000,
            },
        });
        const msg = (message: ServerMessage) =>
            ({ type: "message", message }) as const;

        it("adds strokes from the server", () => {
            let s = roomReducer(
                initialRoomState,
                msg({ type: "draw", stroke: chunk(0) }),
            );
            s = roomReducer(
                s,
                msg({
                    type: "draw",
                    stroke: chunk(0, { points: [[2, 2]], done: true }),
                }),
            );
            expect(s.strokes).toHaveLength(1);
            expect(s.strokes[0]).toMatchObject({
                points: [
                    [1, 1],
                    [2, 2],
                ],
                done: true,
            });
        });

        it("replaces the drawing with a canvas message", () => {
            let s = roomReducer(
                initialRoomState,
                msg({ type: "draw", stroke: chunk(0) }),
            );
            s = roomReducer(s, msg({ type: "canvas", strokes: [] }));
            expect(s.strokes).toEqual([]);
        });

        it("keeps the drawing when the same turn sends a new state", () => {
            let s = roomReducer(
                initialRoomState,
                msg({ type: "room_state", room: inGame(1) }),
            );
            s = roomReducer(s, msg({ type: "draw", stroke: chunk(0) }));
            s = roomReducer(s, msg({ type: "room_state", room: inGame(1) }));
            expect(s.strokes).toHaveLength(1);
        });

        it("clears the drawing in a new turn and when the game ends", () => {
            let s = roomReducer(
                initialRoomState,
                msg({ type: "room_state", room: inGame(1) }),
            );
            s = roomReducer(s, msg({ type: "draw", stroke: chunk(0) }));
            expect(
                roomReducer(s, msg({ type: "room_state", room: inGame(2) }))
                    .strokes,
            ).toEqual([]);
            expect(
                roomReducer(s, msg({ type: "room_state", room })).strokes,
            ).toEqual([]);
        });

        it("keeps the canvas that comes after the room state for a new player", () => {
            let s = roomReducer(
                initialRoomState,
                msg({ type: "room_state", room: inGame(1) }),
            );
            s = roomReducer(
                s,
                msg({
                    type: "canvas",
                    strokes: [
                        {
                            id: 0,
                            colour: 0,
                            size: 0,
                            points: [[1, 1]],
                            done: true,
                        },
                    ],
                }),
            );
            expect(s.strokes).toHaveLength(1);
        });

        it("shows the drawer's own strokes, undo and clear at once", () => {
            let s = roomReducer(initialRoomState, {
                type: "local_chunk",
                chunk: chunk(0, { done: true }),
            });
            s = roomReducer(s, {
                type: "local_chunk",
                chunk: chunk(1, { done: true }),
            });
            expect(s.strokes).toHaveLength(2);
            s = roomReducer(s, { type: "local_undo" });
            expect(s.strokes.map((x) => x.id)).toEqual([0]);
            s = roomReducer(s, { type: "local_clear" });
            expect(s.strokes).toEqual([]);
        });

        it("does not show a notice when a stroke comes too late", () => {
            let s = roomReducer(
                initialRoomState,
                msg({ type: "room_state", room }),
            );
            s = roomReducer(
                s,
                msg({
                    type: "error",
                    code: "not_drawer",
                    message: "You cannot draw now",
                }),
            );
            expect(s.error).toBeNull();
        });
    });

    describe("chat", () => {
        const msg = (message: ServerMessage) =>
            ({ type: "message", message }) as const;
        const line = (text: string): ServerMessage => ({
            type: "chat",
            message: {
                kind: "chat",
                playerId: "p1",
                name: "ann",
                text,
                knowsWord: false,
            },
        });

        it("adds messages in order, with a different key for each", () => {
            let s = roomReducer(initialRoomState, msg(line("one")));
            s = roomReducer(s, msg(line("two")));
            expect(s.chat.map((m) => m.text)).toEqual(["one", "two"]);
            expect(new Set(s.chat.map((m) => m.key)).size).toBe(2);
        });

        it("keeps only the last 100 messages, and keys stay different", () => {
            let s = initialRoomState;
            for (let i = 0; i < 130; i++)
                s = roomReducer(s, msg(line(`m${i}`)));
            expect(s.chat).toHaveLength(100);
            expect(s.chat[0]!.text).toBe("m30");
            expect(new Set(s.chat.map((m) => m.key)).size).toBe(100);
        });

        it("keeps the chat when a new room state comes, and clears it when the player leaves", () => {
            let s = roomReducer(initialRoomState, msg(line("one")));
            s = roomReducer(s, msg({ type: "room_state", room }));
            expect(s.chat).toHaveLength(1);
            s = roomReducer(s, msg({ type: "left" }));
            expect(s.chat).toEqual([]);
        });

        it("keeps guessed and close messages as they are", () => {
            let s = roomReducer(
                initialRoomState,
                msg({
                    type: "chat",
                    message: {
                        kind: "guessed",
                        playerId: "p2",
                        name: "bob",
                        text: "",
                        knowsWord: false,
                    },
                }),
            );
            s = roomReducer(
                s,
                msg({
                    type: "chat",
                    message: {
                        kind: "close",
                        playerId: "p2",
                        name: "bob",
                        text: "",
                        knowsWord: false,
                    },
                }),
            );
            expect(s.chat.map((m) => m.kind)).toEqual(["guessed", "close"]);
        });
    });

    describe("reconnecting", () => {
        const msg = (message: ServerMessage) =>
            ({ type: "message", message }) as const;
        const joined = () => {
            let s = roomReducer(
                initialRoomState,
                msg({ type: "welcome", playerId: "p1" }),
            );
            s = roomReducer(s, msg({ type: "room_state", room }));
            s = roomReducer(
                s,
                msg({
                    type: "chat",
                    message: {
                        kind: "chat",
                        playerId: "p1",
                        name: "ann",
                        text: "hi",
                        knowsWord: false,
                    },
                }),
            );
            return s;
        };

        it("keeps the room, the chat and the player while the page tries again", () => {
            const s = roomReducer(joined(), { type: "reconnecting" });
            expect(s.status).toBe("reconnecting");
            expect(s.room).toEqual(room);
            expect(s.chat).toHaveLength(1);
            expect(s.playerId).toBe("p1");
        });

        it("is joined again when the server sends the room", () => {
            let s = roomReducer(joined(), { type: "reconnecting" });
            s = roomReducer(s, msg({ type: "room_state", room }));
            expect(s.status).toBe("joined");
            expect(s.error).toBeNull();
        });

        it("ends the page when the new join fails", () => {
            let s = roomReducer(joined(), { type: "reconnecting" });
            s = roomReducer(
                s,
                msg({
                    type: "error",
                    code: "room_not_found",
                    message: "That room does not exist",
                }),
            );
            expect(s).toMatchObject({
                status: "error",
                error: "That room does not exist",
            });
        });

        it("closes the page if there is no room to keep", () => {
            expect(
                roomReducer(initialRoomState, { type: "reconnecting" }).status,
            ).toBe("closed");
        });

        it("closes the page when all tries fail", () => {
            const s = roomReducer(
                roomReducer(joined(), { type: "reconnecting" }),
                { type: "socket_closed" },
            );
            expect(s.status).toBe("closed");
        });
    });
});
