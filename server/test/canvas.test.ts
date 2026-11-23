import { describe, expect, it } from "vitest";
import { applyChunk, undoLast, type CanvasLimits } from "../src/canvas.js";
import {
    clientMessageSchema,
    chatTextSchema,
    type Stroke,
    type StrokeChunk,
} from "../src/protocol.js";

const chunk = (
    id: number,
    points: [number, number][],
    extra: Partial<StrokeChunk> = {},
): StrokeChunk => ({
    id,
    colour: 1,
    size: 1,
    points,
    ...extra,
});

describe("applyChunk", () => {
    it("starts a new stroke", () => {
        const result = applyChunk([], chunk(0, [[1, 2]]));
        expect(result?.strokes).toEqual([
            { id: 0, colour: 1, size: 1, points: [[1, 2]], done: false },
        ]);
    });

    it("continues a stroke and ends it", () => {
        let strokes: Stroke[] = applyChunk([], chunk(0, [[1, 2]]))!.strokes;
        strokes = applyChunk(
            strokes,
            chunk(0, [
                [3, 4],
                [5, 6],
            ]),
        )!.strokes;
        strokes = applyChunk(
            strokes,
            chunk(0, [[7, 8]], { done: true }),
        )!.strokes;
        expect(strokes).toHaveLength(1);
        expect(strokes[0]).toMatchObject({
            points: [
                [1, 2],
                [3, 4],
                [5, 6],
                [7, 8],
            ],
            done: true,
        });
    });

    it("does not change the old list", () => {
        const first = applyChunk([], chunk(0, [[1, 2]]))!.strokes;
        applyChunk(first, chunk(0, [[3, 4]]));
        expect(first[0]!.points).toEqual([[1, 2]]);
    });

    it("keeps the colour and size of the first chunk", () => {
        const first = applyChunk(
            [],
            chunk(0, [[1, 2]], { colour: 2, size: 0 }),
        )!.strokes;
        const next = applyChunk(
            first,
            chunk(0, [[3, 4]], { colour: 5, size: 2 }),
        )!;
        expect(next.strokes[0]).toMatchObject({ colour: 2, size: 0 });
        expect(next.chunk).toMatchObject({ colour: 2, size: 0 });
    });

    it("rejects a chunk for a stroke that is done", () => {
        const strokes = applyChunk(
            [],
            chunk(0, [[1, 2]], { done: true }),
        )!.strokes;
        expect(applyChunk(strokes, chunk(0, [[3, 4]]))).toBeNull();
    });

    it("needs a higher id for each new stroke", () => {
        const strokes = applyChunk(
            [],
            chunk(5, [[1, 2]], { done: true }),
        )!.strokes;
        expect(applyChunk(strokes, chunk(5, [[1, 2]]))).toBeNull();
        expect(applyChunk(strokes, chunk(4, [[1, 2]]))).toBeNull();
        expect(applyChunk(strokes, chunk(6, [[1, 2]]))).not.toBeNull();
    });

    it("closes an open stroke when a new one starts", () => {
        const open = applyChunk([], chunk(0, [[1, 2]]))!.strokes;
        const next = applyChunk(open, chunk(1, [[3, 4]]))!.strokes;
        expect(next.map((s) => s.done)).toEqual([true, false]);
    });

    describe("limits", () => {
        const limits: CanvasLimits = {
            maxStrokes: 2,
            maxPointsPerStroke: 3,
            maxPointsTotal: 5,
        };

        it("limits the number of strokes", () => {
            let strokes = applyChunk(
                [],
                chunk(0, [[1, 1]], { done: true }),
                limits,
            )!.strokes;
            strokes = applyChunk(
                strokes,
                chunk(1, [[1, 1]], { done: true }),
                limits,
            )!.strokes;
            expect(applyChunk(strokes, chunk(2, [[1, 1]]), limits)).toBeNull();
        });

        it("limits the points of one stroke", () => {
            const strokes = applyChunk(
                [],
                chunk(0, [
                    [1, 1],
                    [2, 2],
                ]),
                limits,
            )!.strokes;
            expect(
                applyChunk(
                    strokes,
                    chunk(0, [
                        [3, 3],
                        [4, 4],
                    ]),
                    limits,
                ),
            ).toBeNull();
            expect(
                applyChunk(strokes, chunk(0, [[3, 3]]), limits),
            ).not.toBeNull();
        });

        it("limits the points of the whole drawing", () => {
            let strokes = applyChunk(
                [],
                chunk(
                    0,
                    [
                        [1, 1],
                        [2, 2],
                        [3, 3],
                    ],
                    { done: true },
                ),
                limits,
            )!.strokes;
            expect(
                applyChunk(
                    strokes,
                    chunk(1, [
                        [1, 1],
                        [2, 2],
                        [3, 3],
                    ]),
                    limits,
                ),
            ).toBeNull();
            strokes = applyChunk(
                strokes,
                chunk(1, [
                    [1, 1],
                    [2, 2],
                ]),
                limits,
            )!.strokes;
            expect(strokes).toHaveLength(2);
        });
    });
});

describe("undoLast", () => {
    it("removes the last stroke only", () => {
        let strokes: Stroke[] = [];
        strokes = applyChunk(
            strokes,
            chunk(0, [[1, 1]], { done: true }),
        )!.strokes;
        strokes = applyChunk(
            strokes,
            chunk(1, [[2, 2]], { done: true }),
        )!.strokes;
        expect(undoLast(strokes).map((s) => s.id)).toEqual([0]);
        expect(undoLast([])).toEqual([]);
    });
});

describe("message rules", () => {
    const draw = (stroke: unknown) =>
        clientMessageSchema.safeParse({ type: "draw", stroke }).success;
    const ok = {
        id: 0,
        colour: 0,
        size: 0,
        points: [
            [0, 0],
            [800, 600],
        ],
    };

    it("accepts a good chunk", () => {
        expect(draw(ok)).toBe(true);
        expect(draw({ ...ok, done: true })).toBe(true);
    });

    it.each([
        ["a point outside the board", { ...ok, points: [[801, 0]] }],
        ["a negative point", { ...ok, points: [[-1, 0]] }],
        ["a point that is not a whole number", { ...ok, points: [[1.5, 0]] }],
        ["no points", { ...ok, points: [] }],
        [
            "too many points",
            { ...ok, points: Array.from({ length: 51 }, () => [1, 1]) },
        ],
        ["a colour that does not exist", { ...ok, colour: 7 }],
        ["a size that does not exist", { ...ok, size: 3 }],
        ["a colour as text", { ...ok, colour: "#ff0000" }],
        ["a negative id", { ...ok, id: -1 }],
    ])("rejects %s", (_label, stroke) => {
        expect(draw(stroke)).toBe(false);
    });
});

describe("chat text rules", () => {
    it("removes spaces at the ends", () => {
        expect(chatTextSchema.parse("  hello  ")).toBe("hello");
    });

    it.each([
        ["an empty text", ""],
        ["only spaces", "   "],
        ["a text with more than 100 characters", "x".repeat(101)],
        ["a new line", "one\ntwo"],
        ["a null character", "a\u0000b"],
        ["a text that is not a string", 5],
    ])("rejects %s", (_label, text) => {
        expect(chatTextSchema.safeParse(text).success).toBe(false);
    });

    it("accepts 100 characters and normal symbols", () => {
        expect(chatTextSchema.safeParse("x".repeat(100)).success).toBe(true);
        expect(
            chatTextSchema.safeParse(
                "is it <b>a cat</b>? \u00e9\u00e8 \ud83d\ude00",
            ).success,
        ).toBe(true);
    });

    it("is part of the client messages", () => {
        expect(
            clientMessageSchema.safeParse({ type: "chat", text: "hi" }).success,
        ).toBe(true);
        expect(clientMessageSchema.safeParse({ type: "chat" }).success).toBe(
            false,
        );
    });
});
