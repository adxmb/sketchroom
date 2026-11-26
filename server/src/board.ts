import type { OwnedStroke, StrokeChunk } from "./protocol.js";

export interface BoardLimits {
    maxStrokes: number;
    maxPointsTotal: number;
    maxStrokesPerPlayer: number;
    maxPointsPerPlayer: number;
    maxPointsPerStroke: number;
}

export const BOARD_LIMITS: BoardLimits = {
    maxStrokes: 800,
    maxPointsTotal: 40_000,
    maxStrokesPerPlayer: 200,
    maxPointsPerPlayer: 10_000,
    maxPointsPerStroke: 2000,
};

export function applyOwned(
    strokes: readonly OwnedStroke[],
    owner: string,
    chunk: StrokeChunk,
    limits: BoardLimits = BOARD_LIMITS,
): { strokes: OwnedStroke[]; chunk: StrokeChunk } | null {
    let lastIndex = -1;
    let ownCount = 0;
    let ownPoints = 0;
    let total = 0;
    strokes.forEach((s, i) => {
        total += s.points.length;
        if (s.owner === owner) {
            lastIndex = i;
            ownCount++;
            ownPoints += s.points.length;
        }
    });
    if (total + chunk.points.length > limits.maxPointsTotal) return null;
    if (ownPoints + chunk.points.length > limits.maxPointsPerPlayer)
        return null;

    const last = lastIndex >= 0 ? strokes[lastIndex]! : undefined;
    const done = chunk.done ?? false;

    if (last && last.id === chunk.id) {
        if (last.done) return null;
        if (
            last.points.length + chunk.points.length >
            limits.maxPointsPerStroke
        )
            return null;
        const next: OwnedStroke = {
            ...last,
            points: [...last.points, ...chunk.points],
            done,
        };
        const list = [...strokes];
        list[lastIndex] = next;
        return {
            strokes: list,
            chunk: { ...chunk, colour: last.colour, size: last.size },
        };
    }

    if (last && chunk.id <= last.id) return null;
    if (
        strokes.length >= limits.maxStrokes ||
        ownCount >= limits.maxStrokesPerPlayer
    )
        return null;
    const list = [...strokes];
    if (last && !last.done) list[lastIndex] = { ...last, done: true };
    list.push({
        owner,
        id: chunk.id,
        colour: chunk.colour,
        size: chunk.size,
        points: [...chunk.points],
        done,
    });
    return { strokes: list, chunk };
}

export function undoOwned(
    strokes: readonly OwnedStroke[],
    owner: string,
): OwnedStroke[] {
    for (let i = strokes.length - 1; i >= 0; i--) {
        if (strokes[i]!.owner === owner)
            return [...strokes.slice(0, i), ...strokes.slice(i + 1)];
    }
    return [...strokes];
}

export function clearOwned(
    strokes: readonly OwnedStroke[],
    owner: string,
): OwnedStroke[] {
    return strokes.filter((s) => s.owner !== owner);
}
