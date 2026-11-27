import { describe, expect, it } from "vitest";
import type { Stroke } from "../../server/src/protocol";
import { buildPdf } from "./exportBoard";

const stroke = (
    id: number,
    points: [number, number][],
    extra: Partial<Stroke> = {},
): Stroke => ({
    id,
    colour: 4,
    size: 1,
    points,
    done: true,
    ...extra,
});

const text = (strokes: Stroke[]) => new TextDecoder().decode(buildPdf(strokes));

describe("buildPdf", () => {
    it("makes a PDF with a header and an end mark", () => {
        const pdf = text([]);
        expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
        expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    });

    it("has a page of 800 by 600 points and a white background", () => {
        const pdf = text([]);
        expect(pdf).toContain("/MediaBox [0 0 800 600]");
        expect(pdf).toContain("1 1 1 rg\n0 0 800 600 re f");
    });

    it("writes a line with colour, width and turned-over y", () => {
        const pdf = text([
            stroke(
                0,
                [
                    [10, 20],
                    [30, 40],
                ],
                { colour: 4, size: 2 },
            ),
        ]);
        // Blue (#2563eb) and the thick brush of 22
        expect(pdf).toContain(
            "0.145 0.388 0.922 RG\n22 w\n10 580 m\n30 560 l\nS",
        );
    });

    it("writes a dot as a filled circle", () => {
        const pdf = text([stroke(0, [[100, 100]], { colour: 0, size: 2 })]);
        expect(pdf).toContain("111 500 m");
        expect(pdf.match(/ c\n/g)).toHaveLength(4);
        expect(pdf).toContain("\nf\n");
    });

    it("writes the strokes in the order of the list, so the eraser works", () => {
        const pdf = text([
            stroke(
                0,
                [
                    [1, 1],
                    [2, 2],
                ],
                { colour: 0 },
            ),
            stroke(
                1,
                [
                    [1, 1],
                    [2, 2],
                ],
                { colour: 6 },
            ),
        ]);
        expect(pdf.indexOf("0.067 0.094 0.153 RG")).toBeLessThan(
            pdf.indexOf("1.000 1.000 1.000 RG"),
        );
    });

    it("has a correct length for the page content", () => {
        const pdf = text([
            stroke(0, [
                [10, 20],
                [30, 40],
            ]),
        ]);
        const length = Number(/\/Length (\d+)/.exec(pdf)![1]);
        const body = pdf.slice(
            pdf.indexOf("stream\n") + 7,
            pdf.indexOf("\nendstream"),
        );
        expect(body.length).toBe(length);
    });

    it("has a table of offsets that points to each object", () => {
        const pdf = text([
            stroke(0, [
                [10, 20],
                [30, 40],
            ]),
            stroke(1, [[5, 5]]),
        ]);
        const start = Number(/startxref\n(\d+)/.exec(pdf)![1]);
        expect(pdf.slice(start, start + 4)).toBe("xref");
        const entries = [
            ...pdf.slice(start).matchAll(/^(\d{10}) 00000 n $/gm),
        ].map((m) => Number(m[1]));
        expect(entries).toHaveLength(4);
        entries.forEach((offset, i) =>
            expect(pdf.slice(offset, offset + 7)).toBe(`${i + 1} 0 obj`),
        );
    });
});
