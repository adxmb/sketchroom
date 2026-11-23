import { describe, expect, it } from "vitest";
import { splitPoints, toLogical } from "./canvasDraw";

describe("toLogical", () => {
    // The board is 800 by 600. Here it is shown at 400 by 300, with its corner at (100, 50)
    const rect = { left: 100, top: 50, width: 400, height: 300 };

    it("scales a position to board units", () => {
        expect(toLogical(100, 50, rect)).toEqual([0, 0]);
        expect(toLogical(300, 200, rect)).toEqual([400, 300]);
        expect(toLogical(500, 350, rect)).toEqual([800, 600]);
    });

    it("keeps a position outside the board on the edge", () => {
        expect(toLogical(0, 0, rect)).toEqual([0, 0]);
        expect(toLogical(9999, 9999, rect)).toEqual([800, 600]);
    });

    it("gives whole numbers", () => {
        const [x, y] = toLogical(101.3, 50.7, rect);
        expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
    });
});

describe("splitPoints", () => {
    const points = Array.from(
        { length: 7 },
        (_, i) => [i, i] as [number, number],
    );

    it("cuts a list into parts", () => {
        expect(splitPoints(points, 3).map((p) => p.length)).toEqual([3, 3, 1]);
    });

    it("keeps the order of the points", () => {
        expect(splitPoints(points, 3).flat()).toEqual(points);
    });

    it("gives no parts for no points", () => {
        expect(splitPoints([], 3)).toEqual([]);
    });
});
