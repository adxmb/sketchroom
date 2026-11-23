import { describe, expect, it } from "vitest";
import { buildOrder, maskWord, nextTurn } from "../src/game/rules.js";

describe("buildOrder", () => {
    it("repeats the players in each round", () => {
        expect(buildOrder(["a", "b"], 2)).toEqual(["a", "b", "a", "b"]);
    });

    it("gives an empty order for no rounds", () => {
        expect(buildOrder(["a", "b"], 0)).toEqual([]);
    });
});

describe("maskWord", () => {
    it("shows one underscore for each letter", () => {
        expect(maskWord("apple")).toBe("_____");
    });

    it("keeps the space in a word with two parts", () => {
        expect(maskWord("ice cream")).toBe("___ _____");
    });
});

describe("nextTurn", () => {
    const order = ["a", "b", "c", "a"];

    it("goes to the next turn", () => {
        expect(nextTurn(order, 0, new Set(["a", "b", "c"]))).toBe(1);
    });

    it("skips a drawer who left", () => {
        expect(nextTurn(order, 0, new Set(["a", "c"]))).toBe(2);
    });

    it("returns null when no turn is left", () => {
        expect(nextTurn(order, 3, new Set(["a", "b", "c"]))).toBeNull();
        expect(nextTurn(order, 0, new Set(["z"]))).toBeNull();
    });
});
