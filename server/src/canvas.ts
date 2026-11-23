/** Rules for the drawing as pure functions */
import type { Stroke, StrokeChunk } from "./protocol.js";

export interface CanvasLimits {
    maxStrokes: number;
    maxPointsPerStroke: number;
    maxPointsTotal: number;
}

/** Limits for a single turn */
export const CANVAS_LIMITS: CanvasLimits = {
    maxStrokes: 300,
    maxPointsPerStroke: 2_000,
    maxPointsTotal: 10_000,
};

function countPoints(strokes: readonly Stroke[]): number {
    return strokes.reduce((sum, s) => sum + s.points.length, 0);
}

/** Add a chunk to a list of strokes */
export function applyChunk(
    strokes: readonly Stroke[],
    chunk: StrokeChunk,
    limits: CanvasLimits = CANVAS_LIMITS,
): { strokes: Stroke[]; chunk: StrokeChunk } | null {
    if (countPoints(strokes) + chunk.points.length > limits.maxPointsTotal)
        return null;
    const last = strokes[strokes.length - 1];
    const done = chunk.done ?? false;

    if (last && last.id === chunk.id) {
        // Continues last stroke
        if (last.done) return null;
        if (
            last.points.length + chunk.points.length >
            limits.maxPointsPerStroke
        )
            return null;
        const next: Stroke = {
            ...last,
            points: [...last.points, ...chunk.points],
            done,
        };
        // Colour and size of first chunk
        return {
            strokes: [...strokes.slice(0, -1), next],
            chunk: { ...chunk, colour: last.colour, size: last.size },
        };
    }

    // New stroke
    if (last && chunk.id <= last.id) return null;
    if (strokes.length >= limits.maxStrokes) return null;
    const finished =
        last && !last.done
            ? [...strokes.slice(0, -1), { ...last, done: true }]
            : [...strokes];
    const stroke: Stroke = {
        id: chunk.id,
        colour: chunk.colour,
        size: chunk.size,
        points: [...chunk.points],
        done,
    };
    return { strokes: [...finished, stroke], chunk };
}

/** Undo last stroke */
export function undoLast(strokes: readonly Stroke[]): Stroke[] {
    return strokes.slice(0, -1);
}
