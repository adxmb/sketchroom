import {
    useEffect,
    useRef,
    useState,
    type CSSProperties,
    type PointerEvent,
} from "react";
import {
    BRUSH_SIZES,
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
    MAX_POINTS_PER_CHUNK,
    PALETTE,
    PLAYER_COLOURS,
    type OwnedStroke,
    type PlayerView,
    type Point,
    type StrokeChunk,
} from "../../../server/src/protocol";
import { SCALE, renderStrokes, splitPoints, toLogical } from "../canvasDraw";
import { exportPdf, exportPng } from "../exportBoard";

const COLOR_NAMES = [
    "Black",
    "Red",
    "Orange",
    "Green",
    "Blue",
    "Purple",
    "Eraser",
];
const SIZE_NAMES = ["Thin", "Medium", "Thick"];
/** The player sends new points, and the place of the pointer, this often */
const SEND_EVERY_MS = 50;

interface Props {
    /** The file name for exports, without the type. For example "sketchroom-ABCDE" */
    fileName: string;
    myId: string | null;
    players: PlayerView[];
    strokes: OwnedStroke[];
    cursors: Record<string, { x: number; y: number }>;
    /** Show a part of a stroke on this screen at once */
    onLocal: (chunk: StrokeChunk) => void;
    /** Send a part of a stroke to the server */
    onSend: (chunk: StrokeChunk) => void;
    onCursor: (x: number, y: number) => void;
    onUndo: () => void;
    onClear: () => void;
}

/** The stroke that this player is making now */
interface LiveStroke {
    id: number;
    colour: number;
    size: number;
    /** Points that the server does not have yet */
    pending: Point[];
    last: Point;
    timer: ReturnType<typeof setInterval>;
}

/** The board of a collab room. All players draw on it at the same time */
export function SharedBoard(props: Props) {
    const { strokes, myId, players, cursors, fileName } = props;
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [colour, setColour] = useState(0);
    const [size, setSize] = useState(1);
    const live = useRef<LiveStroke | null>(null);
    const lastCursorAt = useRef(0);
    // The handlers read the newest props from this ref
    const latest = useRef(props);
    latest.current = props;

    const mine = strokes.filter((s) => s.owner === myId);

    useEffect(() => {
        const ctx = canvasRef.current?.getContext("2d");
        if (ctx) renderStrokes(ctx, strokes);
    }, [strokes]);

    // When the board goes away, end the stroke without sending more
    useEffect(
        () => () => {
            if (live.current) clearInterval(live.current.timer);
            live.current = null;
        },
        [],
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
        if (live.current || e.button !== 0 || !latest.current.myId) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const point = pointOf(e);
        // The ids of the strokes of this player go up by one. The ids of other players do not matter
        const ownLast = latest.current.strokes
            .filter((s) => s.owner === latest.current.myId)
            .at(-1);
        const id = ownLast ? ownLast.id + 1 : 0;
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
        const point = pointOf(e);
        // Tell the others where the pointer is, also when the player does not draw
        const now = Date.now();
        if (now - lastCursorAt.current >= SEND_EVERY_MS) {
            lastCursorAt.current = now;
            latest.current.onCursor(point[0], point[1]);
        }
        const s = live.current;
        if (!s) return;
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

    const others = players.filter(
        (p) => p.id !== myId && p.connected && cursors[p.id],
    );

    return (
        <div className="board-wrap">
            <div className="board-stage">
                <canvas
                    ref={canvasRef}
                    className="board-canvas drawable"
                    width={CANVAS_WIDTH * SCALE}
                    height={CANVAS_HEIGHT * SCALE}
                    role="img"
                    aria-label="Shared drawing board"
                    onPointerDown={onDown}
                    onPointerMove={onMove}
                    onPointerUp={onUp}
                    onPointerCancel={onUp}
                />
                {others.map((p) => {
                    const c = cursors[p.id]!;
                    return (
                        <div
                            key={p.id}
                            className="remote-cursor"
                            data-testid="remote-cursor"
                            style={
                                {
                                    left: `${(c.x / CANVAS_WIDTH) * 100}%`,
                                    top: `${(c.y / CANVAS_HEIGHT) * 100}%`,
                                    "--cursor":
                                        PLAYER_COLOURS[p.colour] ??
                                        PLAYER_COLOURS[0],
                                } as CSSProperties
                            }
                            aria-hidden="true"
                        >
                            <span className="remote-cursor-dot" />
                            <span className="remote-cursor-name">{p.name}</span>
                        </div>
                    );
                })}
            </div>
            <div className="tools">
                <div className="tool-group" role="group" aria-label="Color">
                    {PALETTE.map((c, i) => (
                        <button
                            key={c}
                            type="button"
                            className={`swatch${colour === i ? " on" : ""}`}
                            style={{ background: c }}
                            aria-label={COLOR_NAMES[i]}
                            aria-pressed={colour === i}
                            onClick={() => setColour(i)}
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
                                style={{ width: w / 2 + 4, height: w / 2 + 4 }}
                            />
                        </button>
                    ))}
                </div>
                <div className="tool-group">
                    <button
                        type="button"
                        className="btn small"
                        onClick={props.onUndo}
                        disabled={mine.length === 0}
                    >
                        Undo
                    </button>
                    <button
                        type="button"
                        className="btn small"
                        title="Removes only your own strokes"
                        onClick={props.onClear}
                        disabled={mine.length === 0}
                    >
                        Clear mine
                    </button>
                </div>
                <div className="tool-group">
                    <button
                        type="button"
                        className="btn small"
                        disabled={strokes.length === 0}
                        onClick={() =>
                            void exportPng(strokes, `${fileName}.png`)
                        }
                    >
                        Save PNG
                    </button>
                    <button
                        type="button"
                        className="btn small"
                        disabled={strokes.length === 0}
                        onClick={() => exportPdf(strokes, `${fileName}.pdf`)}
                    >
                        Save PDF
                    </button>
                </div>
            </div>
        </div>
    );
}
