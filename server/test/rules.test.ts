import { describe, expect, it } from "vitest";
import {
    buildOrder,
    maskWord,
    nextTurn,
    drawerScore,
    guesserScore,
    isCloseGuess,
    isCorrectGuess,
    rankPlayers,
} from "../src/game/rules.js";

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

describe("isCorrectGuess", () => {
    it("ignores letter case and extra spaces", () => {
        expect(isCorrectGuess("  APPLE ", "apple")).toBe(true);
        expect(isCorrectGuess("ice   cream", "ice cream")).toBe(true);
    });

    it("rejects a different word", () => {
        expect(isCorrectGuess("apples", "apple")).toBe(false);
        expect(isCorrectGuess("icecream", "ice cream")).toBe(false);
    });
});

describe("isCloseGuess", () => {
    it("accepts a word that is one letter away", () => {
        expect(isCloseGuess("apples", "apple")).toBe(true); // one more letter
        expect(isCloseGuess("aple", "apple")).toBe(true); // one less letter
        expect(isCloseGuess("appli", "apple")).toBe(true); // one changed letter
    });

    it("rejects the right word, far words and short words", () => {
        expect(isCloseGuess("apple", "apple")).toBe(false);
        expect(isCloseGuess("banana", "apple")).toBe(false);
        expect(isCloseGuess("cot", "cat")).toBe(false);
        expect(isCloseGuess("appel", "apple")).toBe(false); // two letters are swapped
    });
});

describe("guesserScore", () => {
    it("gives 500 for an instant guess and 100 at the end", () => {
        expect(guesserScore(60_000, 60_000)).toBe(500);
        expect(guesserScore(30_000, 60_000)).toBe(300);
        expect(guesserScore(0, 60_000)).toBe(100);
    });

    it("stays between 100 and 500", () => {
        expect(guesserScore(-5, 60_000)).toBe(100);
        expect(guesserScore(90_000, 60_000)).toBe(500);
        expect(guesserScore(10, 0)).toBe(100);
    });
});

describe("drawerScore", () => {
    it("is in proportion to the guessers who found the word", () => {
        expect(drawerScore(0, 3)).toBe(0);
        expect(drawerScore(1, 2)).toBe(150);
        expect(drawerScore(3, 3)).toBe(300);
    });

    it("is 0 when there are no guessers", () => {
        expect(drawerScore(0, 0)).toBe(0);
    });
});

describe("rankPlayers", () => {
    it("sorts by score and gives equal ranks for equal scores", () => {
        const ranked = rankPlayers([
            { name: "cat", score: 100 },
            { name: "ann", score: 300 },
            { name: "bob", score: 300 },
            { name: "dan", score: 50 },
        ]);
        expect(ranked.map((p) => [p.name, p.rank])).toEqual([
            ["ann", 1],
            ["bob", 1],
            ["cat", 3],
            ["dan", 4],
        ]);
    });
});
