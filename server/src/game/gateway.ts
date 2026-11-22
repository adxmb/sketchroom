import websocket from "@fastify/websocket";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { WebSocket } from "ws";
import { SESSION_COOKIE, getUserByToken } from "../auth/sessions.js";
import { isUsernameTaken } from "../auth/users.js";
import type { Db } from "../db/types.js";
import {
    clientMessageSchema,
    createRoomSchema,
    type ErrorCode,
    type RoomView,
    type ServerMessage,
} from "../protocol.js";
import type { RoomManager } from "./rooms.js";

export interface GatewayOptions {
    db: Db;
    rooms: RoomManager;
    /** Where is allowed to open a ws */
    allowedOrigins: string[];
    /** Messages a connection can send per sec */
    messagesPerSecond: number;
    /** Rooms one IP address can create per min */
    createRoomLimit: number;
}

const ERROR_TEXT: Record<ErrorCode, string> = {
    bad_message: "This message is not valid",
    room_not_found: "That room does not exist",
    room_full: "That room is full",
    name_taken: "That name is in use in this room",
    name_reserved:
        "That name belongs to an account.. Pick another name or login",
    name_required: "Pick a name to join",
    already_joined: "You are already in a room",
    rate_limited: "You send messages too fast",
};

/**
 * A browser always sends an Origin header with a WS request
 * Accept only if it is the site's own address of a listed one
 * Stops other sites from using a visitor's cookie to open a connection
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

    function broadcast(view: RoomView) {
        const text = JSON.stringify({
            type: "room_state",
            room: view,
        } satisfies ServerMessage);
        for (const socket of sockets.get(view.code)?.values() ?? []) {
            if (socket.readyState === socket.OPEN) socket.send(text);
        }
    }

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
            // Start the account lookup now. Handle messages one at a time
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
                const view = rooms.leave(code, playerId);
                if (view) broadcast(view);
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
                    // Kicked out of inactive room
                    const view = rooms.leave(message.code, result.player.id);
                    if (view) broadcast(view);
                    return;
                }
                joined = { code: message.code, playerId: result.player.id };
                let members = sockets.get(message.code);
                if (!members) sockets.set(message.code, (members = new Map()));
                members.set(result.player.id, socket);
                send({ type: "welcome", playerId: result.player.id });
                broadcast(result.room);
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
