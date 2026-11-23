import websocket from "@fastify/websocket";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { SESSION_COOKIE, getUserByToken } from "../auth/sessions.js";
import { isUsernameTaken } from "../auth/users.js";
import type { Db } from "../db/types.js";
import {
    clientMessageSchema,
    createRoomSchema,
    type ErrorCode,
    type ServerMessage,
} from "../protocol.js";
import type { RoomManager } from "./rooms.js";
import { pickWords } from "./words.js";
import { pl } from "zod/v4/locales";

export interface GatewayOptions {
    db: Db;
    rooms: RoomManager;
    /** Origins that may open a WebSocket, besides the site's own address */
    allowedOrigins: string[];
    /** Messages a connection can send each second */
    messagesPerSecond: number;
    /** Rooms one IP address can create each minute */
    createRoomLimit: number;
    /** How often the server checks the game timers */
    tickMs: number;
}

const ERROR_TEXT: Record<ErrorCode, string> = {
    bad_message: "The message is not valid",
    room_not_found: "That room does not exist",
    room_full: "That room is full",
    name_taken: "That name is in use in this room",
    name_reserved:
        "That name belongs to an account. Pick another name or log in",
    name_required: "Pick a name to join",
    already_joined: "You are already in a room",
    not_in_room: "Join a room first",
    not_host: "Only the host can start the game",
    not_enough_players: "A game needs at least 2 players",
    game_running: "A game is already running",
    not_drawer: "You cannot draw now",
    canvas_limit: "The drawing is too big",
    server_error: "The server had a problem. Try again",
    rate_limited: "You send messages too fast",
};

/**
 * A browser always sends an Origin header with a WebSocket request. Accept it only if
 * it is the site's own address or a listed one. This stops other web sites from using
 * a visitor's cookie to open a connection. A client with no Origin is not a browser.
 */
export function originAllowed(
    origin: string | undefined,
    host: string | undefined,
    allowed: string[],
) {
    if (!origin) return true;
    if (allowed.includes(origin)) return true;
    try {
        return new URL(origin).host === host;
    } catch {
        return false;
    }
}

export async function gateway(app: FastifyInstance, opts: GatewayOptions) {
    const { db, rooms } = opts;
    // room code -> player id -> socket
    const sockets = new Map<string, Map<string, WebSocket>>();

    await app.register(websocket, { options: { maxPayload: 4096 } });

    app.post(
        "/api/rooms",
        {
            config: {
                rateLimit: {
                    max: opts.createRoomLimit,
                    timeWindow: "1 minute",
                },
            },
        },
        async (request, reply) => {
            const parsed = createRoomSchema.safeParse(request.body);
            if (!parsed.success)
                return reply.code(400).send({ error: "Invalid room settings" });
            const result = rooms.createRoom(parsed.data.mode);
            if (!result.ok)
                return reply
                    .code(503)
                    .send({ error: "The server is full. Try again later" });
            return reply.code(201).send({ code: result.code });
        },
    );

    /** Send each player their own view. Only the drawer gets the secret word */
    function broadcast(code: string) {
        for (const [playerId, socket] of sockets.get(code) ?? []) {
            const room = rooms.view(code, playerId);
            if (room && socket.readyState === socket.OPEN) {
                socket.send(
                    JSON.stringify({
                        type: "room_state",
                        room,
                    } satisfies ServerMessage),
                );
            }
        }
    }

    function sendToOthers(
        code: string,
        expectId: string,
        message: ServerMessage,
    ) {
        const text = JSON.stringify(message);
        for (const [playerId, socket] of sockets.get(code) ?? []) {
            if (playerId !== expectId && socket.readyState === socket.OPEN)
                socket.send(text);
        }
    }

    // Game timers. Rooms that changed get a new state
    const ticker = setInterval(() => {
        for (const code of rooms.tick()) broadcast(code);
    }, opts.tickMs);
    ticker.unref();
    app.addHook("onClose", async () => clearInterval(ticker));

    const checkOrigin = async (
        request: FastifyRequest,
        reply: FastifyReply,
    ) => {
        if (
            !originAllowed(
                request.headers.origin,
                request.headers.host,
                opts.allowedOrigins,
            )
        ) {
            return reply.code(403).send({ error: "Origin not allowed" });
        }
    };

    app.get(
        "/ws",
        { websocket: true, preValidation: checkOrigin },
        (socket, request) => {
            // Start the account lookup now. Handle messages one at a time, in order
            const userPromise = getUserByToken(
                db,
                request.cookies[SESSION_COOKIE],
            ).catch(() => null);
            let joined: { code: string; playerId: string } | null = null;
            let chain: Promise<void> = Promise.resolve();
            let windowStart = Date.now();
            let windowCount = 0;

            const send = (message: ServerMessage) => {
                if (socket.readyState === socket.OPEN)
                    socket.send(JSON.stringify(message));
            };
            const fail = (code: ErrorCode) =>
                send({ type: "error", code, message: ERROR_TEXT[code] });

            function leave() {
                if (!joined) return;
                const { code, playerId } = joined;
                joined = null;
                const members = sockets.get(code);
                members?.delete(playerId);
                if (members?.size === 0) sockets.delete(code);
                if (rooms.leave(code, playerId)) broadcast(code);
            }

            async function handle(raw: string) {
                let json: unknown;
                try {
                    json = JSON.parse(raw);
                } catch {
                    return fail("bad_message");
                }
                const parsed = clientMessageSchema.safeParse(json);
                if (!parsed.success) return fail("bad_message");
                const message = parsed.data;

                if (message.type === "leave_room") {
                    leave();
                    return send({ type: "left" });
                }

                if (message.type === "start_game") {
                    if (!joined) return fail("not_in_room");
                    const { code, playerId } = joined;
                    // Check first, so a player who cannot start does not cause a database query
                    const problem = rooms.startError(code, playerId);
                    if (problem)
                        return fail(
                            problem === "room_not_found"
                                ? "not_in_room"
                                : problem,
                        );
                    let words: string[];
                    try {
                        words = await pickWords(db, rooms.wordsNeeded);
                    } catch (err) {
                        request.log.error(err);
                        return fail("server_error");
                    }
                    if (words.length === 0) return fail("server_error");
                    const result = rooms.startGame(code, playerId, words);
                    if (!result.ok)
                        return fail(
                            result.error === "room_not_found"
                                ? "not_in_room"
                                : result.error,
                        );
                    return broadcast(code);
                }

                if (
                    message.type === "draw" ||
                    message.type === "undo_stroke" ||
                    message.type === "clear_canvas"
                ) {
                    if (!joined) return fail("not_in_room");
                    const { code, playerId } = joined;
                    if (message.type === "draw") {
                        const result = rooms.draw(
                            code,
                            playerId,
                            message.stroke,
                        );
                        if (!result.ok) return fail(result.error);
                        return sendToOthers(code, playerId, {
                            type: "draw",
                            stroke: result.chunk,
                        });
                    }
                    const allowed =
                        message.type === "undo_stroke"
                            ? rooms.undoStroke(code, playerId)
                            : rooms.clearCanvas(code, playerId);
                    if (!allowed) return fail("not_drawer");
                    return sendToOthers(code, playerId, {
                        type: "canvas",
                        strokes: rooms.strokes(code),
                    });
                }

                // join_room
                if (joined) return fail("already_joined");
                const user = await userPromise;
                let name: string;
                if (user) {
                    name = user.username;
                } else {
                    if (!message.name) return fail("name_required");
                    if (await isUsernameTaken(db, message.name))
                        return fail("name_reserved");
                    name = message.name;
                }
                const result = rooms.join(message.code, {
                    name,
                    userId: user?.id ?? null,
                });
                if (!result.ok) return fail(result.error);

                if (socket.readyState !== socket.OPEN) {
                    // The connection closed while we waited. Do not leave a ghost in the room
                    if (rooms.leave(message.code, result.player.id))
                        broadcast(message.code);
                    return;
                }
                joined = { code: message.code, playerId: result.player.id };
                let members = sockets.get(message.code);
                if (!members) sockets.set(message.code, (members = new Map()));
                members.set(result.player.id, socket);
                send({ type: "welcome", playerId: result.player.id });
                broadcast(message.code);
                const strokes = rooms.strokes(message.code);
                if (strokes.length > 0) send({ type: "canvas", strokes });
            }

            socket.on("message", (data, isBinary) => {
                const now = Date.now();
                if (now - windowStart >= 1000) {
                    windowStart = now;
                    windowCount = 0;
                }
                if (++windowCount > opts.messagesPerSecond) {
                    fail("rate_limited");
                    socket.close(1008, "Too many messages");
                    return;
                }
                if (isBinary) return fail("bad_message");
                chain = chain
                    .then(() => handle(data.toString()))
                    .catch((err) => request.log.error(err));
            });

            socket.on("close", () => {
                chain = chain.then(leave);
            });
            socket.on("error", () => socket.terminate());
        },
    );
}
