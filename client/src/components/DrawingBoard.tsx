import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
    BRUSH_SIZES,
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
    MAX_POINTS_PER_CHUNK,
    PALETTE,
    type Point,
    type Stroke,
    type StrokeChunk,
} from "../../../server/src/protocol";
import { SCALE, renderStrokes, splitPoints, toLogical } from "../canvasDraw";

const COLOUR_NAMES = [
    "Black",
    "Red",
    "Orange",
    "Green",
    "Blue",
    "Purple",
    "Eraser",
];
const SIZE_NAMES = ["Thin", "Medium", "Thick"];
/** The drawer sends the new points to the server this often */
const SEND_EVERY_MS = 50;

interface Props {
    strokes: Stroke[];
    /** True only for the drawer, while the time to draw is not over */
    canDraw: boolean;
    /** Show a part of a stroke on this screen at once */
    onLocal: (chunk: StrokeChunk) => void;
    /** Send a part of a stroke to the server */
    onSend: (chunk: StrokeChunk) => void;
    onUndo: () => void;
    onClear: () => void;
}

/** The stroke that the drawer is making now */
interface LiveStroke {
    id: number;
    colour: number;
    size: number;
    /** Points that the server does not have yet */
    pending: Point[];
    last: Point;
    timer: ReturnType<typeof setInterval>;
}

export function DrawingBoard(props: Props) {
    const { strokes, canDraw } = props;
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [colour, setcolour] = useState(0);
    const [size, setSize] = useState(1);
    const live = useRef<LiveStroke | null>(null);
    // The handlers read the newest props and strokes from these refs
    const latest = useRef(props);
    latest.current = props;

    useEffect(() => {
        const ctx = canvasRef.current?.getContext("2d");
        if (ctx) renderStrokes(ctx, strokes);
    }, [strokes]);

    // When the time to draw ends, or the board goes away, end the stroke without sending more
    useEffect(
        () => () => {
            if (live.current) clearInterval(live.current.timer);
            live.current = null;
        },
        [canDraw],
    );

    const flush = (done: boolean) => {
        const s = live.current;
        if (!s) return;
        // A stroke needs at least one point in its last chunk. Use the last point again
        const points = s.pending.length > 0 ? s.pending : done ? [s.last] : [];
        s.pending = [];
        const parts = splitPoints(points, MAX_POINTS_PER_CHUNK);
        parts.forEach((part, i) => {
            const isLast = done && i === parts.length - 1;
            latest.current.onSend({
                id: s.id,
                colour: s.colour,
                size: s.size,
                points: part,
                ...(isLast ? { done: true } : {}),
            });
        });
    };

    const pointOf = (e: PointerEvent<HTMLCanvasElement>) =>
        toLogical(
            e.clientX,
            e.clientY,
            e.currentTarget.getBoundingClientRect(),
        );

    const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
        if (!latest.current.canDraw || live.current || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const point = pointOf(e);
        const lastStroke = latest.current.strokes.at(-1);
        const id = lastStroke ? lastStroke.id + 1 : 0;
        live.current = {
            id,
            colour,
            size,
            pending: [point],
            last: point,
            timer: setInterval(() => flush(false), SEND_EVERY_MS),
        };
        latest.current.onLocal({ id, colour, size, points: [point] });
    };

    const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
        const s = live.current;
        if (!s) return;
        const point = pointOf(e);
        if (point[0] === s.last[0] && point[1] === s.last[1]) return;
        s.last = point;
        s.pending.push(point);
        latest.current.onLocal({
            id: s.id,
            colour: s.colour,
            size: s.size,
            points: [point],
        });
    };

    const onUp = () => {
        const s = live.current;
        if (!s) return;
        clearInterval(s.timer);
        flush(true);
        latest.current.onLocal({
            id: s.id,
            colour: s.colour,
            size: s.size,
            points: [s.last],
            done: true,
        });
        live.current = null;
    };

    return (
        <div className="board-wrap">
            <canvas
                ref={canvasRef}
                className={`board-canvas${canDraw ? " drawable" : ""}`}
                width={CANVAS_WIDTH * SCALE}
                height={CANVAS_HEIGHT * SCALE}
                role="img"
                aria-label="Drawing board"
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
            />
            {canDraw && (
                <div className="tools">
                    <div
                        className="tool-group"
                        role="group"
                        aria-label="colour"
                    >
                        {PALETTE.map((c, i) => (
                            <button
                                key={c}
                                type="button"
                                className={`swatch${colour === i ? " on" : ""}`}
                                style={{ background: c }}
                                aria-label={COLOUR_NAMES[i]}
                                aria-pressed={colour === i}
                                onClick={() => setcolour(i)}
                            />
                        ))}
                    </div>
                    <div
                        className="tool-group"
                        role="group"
                        aria-label="Brush size"
                    >
                        {BRUSH_SIZES.map((w, i) => (
                            <button
                                key={w}
                                type="button"
                                className={`size${size === i ? " on" : ""}`}
                                aria-label={SIZE_NAMES[i]}
                                aria-pressed={size === i}
                                onClick={() => setSize(i)}
                            >
                                <span
                                    style={{
                                        width: w / 2 + 4,
                                        height: w / 2 + 4,
                                    }}
                                />
                            </button>
                        ))}
                    </div>
                    <div className="tool-group">
                        <button
                            type="button"
                            className="btn small"
                            onClick={props.onUndo}
                            disabled={strokes.length === 0}
                        >
                            Undo
                        </button>
                        <button
                            type="button"
                            className="btn small"
                            onClick={props.onClear}
                            disabled={strokes.length === 0}
                        >
                            Clear
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
