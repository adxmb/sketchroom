import {
    BRUSH_SIZES,
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
    PALETTE,
    type Point,
    type Stroke,
} from "../../server/src/protocol";

export const SCALE = 2;

/** Turn pointer pos on screen to point on board */
export function toLogical(
    clientX: number,
    clientY: number,
    rect: { left: number; top: number; width: number; height: number },
): Point {
    const clamp = (n: number, max: number) =>
        Math.min(max, Math.max(0, Math.round(n)));
    return [
        clamp(
            ((clientX - rect.left) / rect.width) * CANVAS_WIDTH,
            CANVAS_WIDTH,
        ),
        clamp(
            ((clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
            CANVAS_HEIGHT,
        ),
    ];
}

export function splitPoints(points: Point[], max: number): Point[][] {
    const parts: Point[][] = [];
    for (let i = 0; i < points.length; i += max)
        parts.push(points.slice(i, i + max));
    return parts;
}

export function renderStrokes(
    ctx: CanvasRenderingContext2D,
    strokes: readonly Stroke[],
) {
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of strokes) {
        const colour = PALETTE[stroke.colour] ?? PALETTE[0];
        const width = BRUSH_SIZES[stroke.size] ?? BRUSH_SIZES[0];
        const [first] = stroke.points;
        if (!first) continue;
        ctx.strokeStyle = colour;
        ctx.fillStyle = colour;
        ctx.lineWidth = width;
        if (stroke.points.length === 1) {
            ctx.beginPath();
            ctx.arc(first[0], first[1], width / 2, 0, Math.PI * 2);
            ctx.fill();
            continue;
        }
        ctx.beginPath();
        ctx.moveTo(first[0], first[1]);
        for (const [x, y] of stroke.points.slice(1)) ctx.lineTo(x, y);
        ctx.stroke();
    }
}
