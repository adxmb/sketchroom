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
import { saveGame } from "../stats.js";
import { GUEST_COOKIE, isGuestId } from "../guest.js";

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
    /** WebSocket connections that one IP address can have at the same time */
    maxConnectionsPerIp: number;
    /** The server pings each connection this often. A connection that does not answer is closed. 0 means no pings */
    heartbeatMs: number;
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
    wrong_mode: "This room does not work that way",
    canvas_limit: "The drawing is too big",
    server_error: "The server had a problem. Try again",
    rate_limited: "You send messages too fast",
};

const CHAT_BURST = 5;
const CHAT_WINDOW_MS = 5000;

/** The server sends the cursor of a player at most this often */
const CURSOR_MIN_MS = 40;

/** A connection can fail this many joins. Then it is closed. This stops a script that guesses room codes */
const MAX_JOIN_FAILURES = 10;

/** Close code for a connection that another connection of the same player replaced */
const CLOSE_REPLACED = 4000;

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

    /** Send one message to all players in a room, or to some of them */
    function deliver(
        code: string,
        to: "all" | string[],
        message: ServerMessage,
    ) {
        if (to === "all") return sendToOthers(code, "", message);
        const text = JSON.stringify(message);
        for (const playerId of to) {
            const socket = sockets.get(code)?.get(playerId);
            if (socket && socket.readyState === socket.OPEN) socket.send(text);
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

    // Game timers. Rooms that changed get a new state. Games that ended are saved
    const ticker = setInterval(() => {
        for (const code of rooms.tick()) broadcast(code);
        for (const game of rooms.takeFinished()) {
            saveGame(db, game).catch((err) => app.log.error(err));
        }
    }, opts.tickMs);
    ticker.unref();
    app.addHook("onClose", async () => clearInterval(ticker));

    // IP address -> number of open connections
    const connectionsByIp = new Map<string, number>();

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
        if (
            (connectionsByIp.get(request.ip) ?? 0) >= opts.maxConnectionsPerIp
        ) {
            return reply.code(429).send({ error: "Too many connections" });
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
            const guestId = request.cookies[GUEST_COOKIE];
            const ip = request.ip;
            connectionsByIp.set(ip, (connectionsByIp.get(ip) ?? 0) + 1);
            let joinFailures = 0;
            let joined: { code: string; playerId: string } | null = null;
            let chain: Promise<void> = Promise.resolve();
            let windowStart = Date.now();
            let windowCount = 0;
            const chatTimes: number[] = [];
            let lastCursorAt = 0;

            const send = (message: ServerMessage) => {
                if (socket.readyState === socket.OPEN)
                    socket.send(JSON.stringify(message));
            };
            const fail = (code: ErrorCode) =>
                send({ type: "error", code, message: ERROR_TEXT[code] });

            function leave(keepSeat: boolean) {
                if (!joined) return;
                const { code, playerId } = joined;
                joined = null;
                const members = sockets.get(code);
                if (members?.get(playerId) !== socket) return;
                members.delete(playerId);
                if (members.size === 0) sockets.delete(code);
                const view = keepSeat
                    ? rooms.disconnect(code, playerId)
                    : rooms.leave(code, playerId);
                if (view) broadcast(code);
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
                    leave(false);
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

                if (message.type === "chat") {
                    if (!joined) return fail("not_in_room");
                    const now = Date.now();
                    while (
                        chatTimes.length > 0 &&
                        now - chatTimes[0]! > CHAT_WINDOW_MS
                    )
                        chatTimes.shift();
                    if (chatTimes.length >= CHAT_BURST)
                        return fail("rate_limited");
                    chatTimes.push(now);
                    const outcome = rooms.chat(
                        joined.code,
                        joined.playerId,
                        message.text,
                    );
                    if (!outcome) return;
                    for (const {
                        to,
                        message: chatMessage,
                    } of outcome.deliveries) {
                        deliver(joined.code, to, {
                            type: "chat",
                            message: chatMessage,
                        });
                    }
                    if (outcome.stateChanged) broadcast(joined.code);
                    return;
                }

                if (message.type === "cursor") {
                    if (!joined) return fail("not_in_room");
                    // Cursors are for shared boards only. A fast sender loses some of them. That is fine
                    const now = Date.now();
                    if (
                        !rooms.hasSharedBoard(joined.code) ||
                        now - lastCursorAt < CURSOR_MIN_MS
                    )
                        return;
                    lastCursorAt = now;
                    return sendToOthers(joined.code, joined.playerId, {
                        type: "cursor",
                        playerId: joined.playerId,
                        x: message.x,
                        y: message.y,
                    });
                }

                if (
                    message.type === "draw" ||
                    message.type === "undo_stroke" ||
                    message.type === "clear_canvas"
                ) {
                    if (!joined) return fail("not_in_room");
                    const { code, playerId } = joined;

                    if (rooms.hasSharedBoard(code)) {
                        if (message.type === "draw") {
                            const result = rooms.boardDraw(
                                code,
                                playerId,
                                message.stroke,
                            );
                            if (!result.ok) return fail(result.error);
                            return sendToOthers(code, playerId, {
                                type: "board_draw",
                                owner: playerId,
                                stroke: result.chunk,
                            });
                        }
                        const changed =
                            message.type === "undo_stroke"
                                ? rooms.boardUndo(code, playerId)
                                : rooms.boardClear(code, playerId);
                        if (!changed) return fail("not_in_room");
                        // Everyone gets the whole board, also the player who did it
                        return deliver(code, "all", {
                            type: "board",
                            strokes: rooms.board(code),
                        });
                    }

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
                const failJoin = (code: ErrorCode) => {
                    fail(code);
                    if (++joinFailures >= MAX_JOIN_FAILURES)
                        socket.close(1008, "Too many failed joins");
                };
                const user = await userPromise;
                let name: string;
                if (user) {
                    name = user.username;
                } else {
                    if (!message.name) return failJoin("name_required");
                    if (await isUsernameTaken(db, message.name))
                        return failJoin("name_reserved");
                    name = message.name;
                }
                // An account is the same player in every browser. A guest is the same player in one browser
                const owner = user
                    ? `u:${user.id}`
                    : isGuestId(guestId)
                      ? `g:${guestId}`
                      : null;
                const result = rooms.join(message.code, {
                    name,
                    userId: user?.id ?? null,
                    owner,
                });
                if (!result.ok) return failJoin(result.error);

                if (socket.readyState !== socket.OPEN) {
                    // The connection closed while we waited. Do not leave a ghost in the room
                    if (
                        !result.resumed &&
                        rooms.leave(message.code, result.player.id)
                    )
                        broadcast(message.code);
                    else if (
                        result.resumed &&
                        rooms.disconnect(message.code, result.player.id)
                    )
                        broadcast(message.code);
                    return;
                }
                joined = { code: message.code, playerId: result.player.id };
                let members = sockets.get(message.code);
                if (!members) sockets.set(message.code, (members = new Map()));
                // The same player can have an old connection that the server did not see close yet. The new one replaces it
                const old = members.get(result.player.id);
                members.set(result.player.id, socket);
                if (old && old !== socket)
                    old.close(CLOSE_REPLACED, "Replaced by a new connection");
                send({ type: "welcome", playerId: result.player.id });
                broadcast(message.code);
                const strokes = rooms.strokes(message.code);
                if (strokes.length > 0) send({ type: "canvas", strokes });

                // A player who joins a shared board gets the whole board
                const board = rooms.board(message.code);
                if (board.length > 0) send({ type: "board", strokes: board });
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

            // Ping the client. A connection that is dead without a close message (a lost network) is found and closed
            let alive = true;
            socket.on("pong", () => {
                alive = true;
            });
            const heartbeat =
                opts.heartbeatMs > 0
                    ? setInterval(() => {
                          if (!alive) return socket.terminate();
                          alive = false;
                          socket.ping();
                      }, opts.heartbeatMs)
                    : null;
            heartbeat?.unref();

            socket.on("close", () => {
                if (heartbeat) clearInterval(heartbeat);
                const count = (connectionsByIp.get(ip) ?? 1) - 1;
                if (count <= 0) connectionsByIp.delete(ip);
                else connectionsByIp.set(ip, count);
                chain = chain.then(() => leave(true));
            });
            socket.on("error", () => socket.terminate());
        },
    );
}
