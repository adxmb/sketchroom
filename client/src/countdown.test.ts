import { describe, expect, it } from "vitest";
import { secondsLeft } from "./countdown";

describe("secondsLeft", () => {
    it("rounds up", () => {
        expect(secondsLeft(60_000)).toBe(60);
        expect(secondsLeft(59_001)).toBe(60);
        expect(secondsLeft(200)).toBe(1);
    });

    it("never goes below 0", () => {
        expect(secondsLeft(0)).toBe(0);
        expect(secondsLeft(-500)).toBe(0);
    });
});
