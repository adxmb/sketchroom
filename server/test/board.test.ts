import { describe, expect, it } from "vitest";
import {
    applyOwned,
    clearOwned,
    undoOwned,
    type BoardLimits,
} from "../src/board.js";
import {
    clientMessageSchema,
    type OwnedStroke,
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

/** Apply chunks one after the other. A chunk that is not allowed stops the test */
function build(
    steps: [string, StrokeChunk][],
    limits?: BoardLimits,
): OwnedStroke[] {
    let strokes: OwnedStroke[] = [];
    for (const [owner, c] of steps) {
        const result = applyOwned(strokes, owner, c, limits);
        if (!result) throw new Error("chunk not allowed");
        strokes = result.strokes;
    }
    return strokes;
}

describe("applyOwned", () => {
    it("starts a stroke with an owner", () => {
        const result = applyOwned([], "ann", chunk(0, [[1, 2]]));
        expect(result?.strokes).toEqual([
            {
                owner: "ann",
                id: 0,
                colour: 1,
                size: 1,
                points: [[1, 2]],
                done: false,
            },
        ]);
    });

    it("lets two players use the same stroke id", () => {
        const strokes = build([
            ["ann", chunk(0, [[1, 1]], { done: true })],
            ["bob", chunk(0, [[2, 2]], { done: true })],
        ]);
        expect(strokes.map((s) => [s.owner, s.id])).toEqual([
            ["ann", 0],
            ["bob", 0],
        ]);
    });

    it("keeps the strokes of two players apart when they draw at the same time", () => {
        const strokes = build([
            ["ann", chunk(0, [[1, 1]])],
            ["bob", chunk(0, [[5, 5]])],
            ["ann", chunk(0, [[2, 2]])],
            ["bob", chunk(0, [[6, 6]], { done: true })],
            ["ann", chunk(0, [[3, 3]], { done: true })],
        ]);
        expect(strokes).toHaveLength(2);
        expect(strokes.find((s) => s.owner === "ann")).toMatchObject({
            points: [
                [1, 1],
                [2, 2],
                [3, 3],
            ],
            done: true,
        });
        expect(strokes.find((s) => s.owner === "bob")).toMatchObject({
            points: [
                [5, 5],
                [6, 6],
            ],
            done: true,
        });
    });

    it("does not change the old list", () => {
        const first = applyOwned([], "ann", chunk(0, [[1, 2]]))!.strokes;
        applyOwned(first, "ann", chunk(0, [[3, 4]]));
        expect(first[0]!.points).toEqual([[1, 2]]);
    });

    it("keeps the colour and size of the first chunk", () => {
        const first = applyOwned(
            [],
            "ann",
            chunk(0, [[1, 2]], { colour: 2, size: 0 }),
        )!.strokes;
        const next = applyOwned(
            first,
            "ann",
            chunk(0, [[3, 4]], { colour: 5, size: 2 }),
        )!;
        expect(next.strokes[0]).toMatchObject({ colour: 2, size: 0 });
        expect(next.chunk).toMatchObject({ colour: 2, size: 0 });
    });

    it("rejects a chunk for a stroke that is done", () => {
        const strokes = build([["ann", chunk(0, [[1, 2]], { done: true })]]);
        expect(applyOwned(strokes, "ann", chunk(0, [[3, 4]]))).toBeNull();
    });

    it("needs a higher id for each new stroke of the same owner", () => {
        const strokes = build([["ann", chunk(5, [[1, 2]], { done: true })]]);
        expect(applyOwned(strokes, "ann", chunk(4, [[1, 2]]))).toBeNull();
        expect(applyOwned(strokes, "ann", chunk(6, [[1, 2]]))).not.toBeNull();
        // The id of another player does not matter
        expect(applyOwned(strokes, "bob", chunk(0, [[1, 2]]))).not.toBeNull();
    });

    it("closes an open stroke of the owner when a new one starts, and no other stroke", () => {
        const strokes = build([
            ["ann", chunk(0, [[1, 1]])],
            ["bob", chunk(0, [[2, 2]])],
            ["ann", chunk(1, [[3, 3]])],
        ]);
        expect(strokes.map((s) => [s.owner, s.id, s.done])).toEqual([
            ["ann", 0, true],
            ["bob", 0, false],
            ["ann", 1, false],
        ]);
    });

    describe("limits", () => {
        const limits: BoardLimits = {
            maxStrokes: 4,
            maxPointsTotal: 8,
            maxStrokesPerPlayer: 2,
            maxPointsPerPlayer: 5,
            maxPointsPerStroke: 3,
        };
        const done = { done: true };

        it("limits the strokes of one player", () => {
            const strokes = build(
                [
                    ["ann", chunk(0, [[1, 1]], done)],
                    ["ann", chunk(1, [[1, 1]], done)],
                ],
                limits,
            );
            expect(
                applyOwned(strokes, "ann", chunk(2, [[1, 1]]), limits),
            ).toBeNull();
            expect(
                applyOwned(strokes, "bob", chunk(0, [[1, 1]]), limits),
            ).not.toBeNull();
        });

        it("limits the strokes of the whole board", () => {
            const strokes = build(
                [
                    ["ann", chunk(0, [[1, 1]], done)],
                    ["ann", chunk(1, [[1, 1]], done)],
                    ["bob", chunk(0, [[1, 1]], done)],
                    ["bob", chunk(1, [[1, 1]], done)],
                ],
                limits,
            );
            expect(
                applyOwned(strokes, "cat", chunk(0, [[1, 1]]), limits),
            ).toBeNull();
        });

        it("limits the points of one stroke", () => {
            const strokes = build(
                [
                    [
                        "ann",
                        chunk(0, [
                            [1, 1],
                            [2, 2],
                        ]),
                    ],
                ],
                limits,
            );
            expect(
                applyOwned(
                    strokes,
                    "ann",
                    chunk(0, [
                        [3, 3],
                        [4, 4],
                    ]),
                    limits,
                ),
            ).toBeNull();
            expect(
                applyOwned(strokes, "ann", chunk(0, [[3, 3]]), limits),
            ).not.toBeNull();
        });

        it("limits the points of one player", () => {
            const strokes = build(
                [
                    [
                        "ann",
                        chunk(
                            0,
                            [
                                [1, 1],
                                [2, 2],
                                [3, 3],
                            ],
                            done,
                        ),
                    ],
                ],
                limits,
            );
            expect(
                applyOwned(
                    strokes,
                    "ann",
                    chunk(1, [
                        [1, 1],
                        [2, 2],
                        [3, 3],
                    ]),
                    limits,
                ),
            ).toBeNull();
            expect(
                applyOwned(
                    strokes,
                    "ann",
                    chunk(1, [
                        [1, 1],
                        [2, 2],
                    ]),
                    limits,
                ),
            ).not.toBeNull();
        });

        it("limits the points of the whole board", () => {
            const strokes = build(
                [
                    [
                        "ann",
                        chunk(
                            0,
                            [
                                [1, 1],
                                [2, 2],
                                [3, 3],
                            ],
                            done,
                        ),
                    ],
                    [
                        "bob",
                        chunk(
                            0,
                            [
                                [1, 1],
                                [2, 2],
                                [3, 3],
                            ],
                            done,
                        ),
                    ],
                ],
                limits,
            );
            expect(
                applyOwned(
                    strokes,
                    "cat",
                    chunk(0, [
                        [1, 1],
                        [2, 2],
                        [3, 3],
                    ]),
                    limits,
                ),
            ).toBeNull();
            expect(
                applyOwned(
                    strokes,
                    "cat",
                    chunk(0, [
                        [1, 1],
                        [2, 2],
                    ]),
                    limits,
                ),
            ).not.toBeNull();
        });
    });
});

describe("undoOwned and clearOwned", () => {
    const strokes = build([
        ["ann", chunk(0, [[1, 1]], { done: true })],
        ["bob", chunk(0, [[2, 2]], { done: true })],
        ["ann", chunk(1, [[3, 3]], { done: true })],
        ["bob", chunk(1, [[4, 4]], { done: true })],
    ]);

    it("undo removes the last stroke of one owner only", () => {
        expect(undoOwned(strokes, "ann").map((s) => [s.owner, s.id])).toEqual([
            ["ann", 0],
            ["bob", 0],
            ["bob", 1],
        ]);
    });

    it("undo of a player without strokes changes nothing", () => {
        expect(undoOwned(strokes, "cat")).toEqual(strokes);
        expect(undoOwned([], "ann")).toEqual([]);
    });

    it("undo does not change the old list", () => {
        undoOwned(strokes, "ann");
        expect(strokes).toHaveLength(4);
    });

    it("clear removes all strokes of one owner only", () => {
        expect(clearOwned(strokes, "bob").map((s) => [s.owner, s.id])).toEqual([
            ["ann", 0],
            ["ann", 1],
        ]);
        expect(clearOwned(strokes, "cat")).toEqual(strokes);
    });

    it("a player can draw again after undo, with the next id", () => {
        const after = undoOwned(strokes, "ann");
        expect(applyOwned(after, "ann", chunk(1, [[9, 9]]))).not.toBeNull();
    });
});

describe("cursor message", () => {
    const cursor = (x: unknown, y: unknown) =>
        clientMessageSchema.safeParse({ type: "cursor", x, y }).success;

    it("accepts a point on the board", () => {
        expect(cursor(0, 0)).toBe(true);
        expect(cursor(800, 600)).toBe(true);
    });

    it.each([
        ["x outside", 801, 0],
        ["y outside", 0, 601],
        ["negative", -1, 0],
        ["not a whole number", 1.5, 2],
        ["text", "1", 2],
    ])("rejects %s", (_label, x, y) => {
        expect(cursor(x, y)).toBe(false);
    });
});
