import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { sep } from "node:path";
import { authRoutes } from "./auth/routes.js";
import type { Db } from "./db/types.js";
import { gateway } from "./game/gateway.js";
import { RoomManager } from "./game/rooms.js";
import { statsRoutes } from "./stats.js";
import { guestRoutes } from "./guest.js";
import { request } from "node:http";

export interface AppOptions {
    db: Db;
    /** Send cookies only over HTTPS. Turn on in prod */
    secureCookies?: boolean;
    /** Trust X-Forwarded-For. Turn on behind a proxy such as Render */
    trustProxy?: string | false;
    authRateLimit?: number;
    /** Where else can open a ws */
    allowedOrigins?: string[];
    rooms?: RoomManager;
    messagesPerSecond?: number;
    createRoomLimit?: number;
    tickMs?: number;
    maxConnectionsPerIp?: number;
    heartbeatMs?: number;
    staticDir?: string | null;
    debugIp?: boolean;
    logger?: boolean;
}

const SECURITY_HEADERS: Record<string, string> = {
    "content-security-policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
        "connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
};

export async function buildApp(opts: AppOptions) {
    const app = Fastify({
        logger: opts.logger ?? false,
        trustProxy: opts.trustProxy || false,
        bodyLimit: 16 * 1024,
    });
    await app.register(cookie);
    await app.register(rateLimit, { global: false });
    await app.register(authRoutes, {
        db: opts.db,
        secureCookies: opts.secureCookies ?? false,
        authRateLimit: opts.authRateLimit ?? 10,
    });
    await app.register(statsRoutes, { db: opts.db });
    await app.register(guestRoutes, {
        secureCookies: opts.secureCookies ?? false,
    });
    await app.register(gateway, {
        db: opts.db,
        rooms: opts.rooms ?? new RoomManager(),
        allowedOrigins: opts.allowedOrigins ?? [],
        messagesPerSecond: opts.messagesPerSecond ?? 30,
        createRoomLimit: opts.createRoomLimit ?? 20,
        tickMs: opts.tickMs ?? 500,
        maxConnectionsPerIp: opts.maxConnectionsPerIp ?? 20,
        heartbeatMs: opts.heartbeatMs ?? 20_000,
    });
    app.get("/health", async () => ({ status: "ok" }));

    if (opts.debugIp) {
        app.get("/debug/ip", async (request) => ({
            ip: request.ip,
            forwardedFor: request.headers["x-forwarded-for"] ?? null,
        }));
    }

    app.addHook("onSend", async (_request, reply) => {
        for (const [name, value] of Object.entries(SECURITY_HEADERS))
            reply.header(name, value);
    });

    if (opts.staticDir) {
        await app.register(fastifyStatic, {
            root: opts.staticDir,
            cacheControl: false,
            setHeaders: (res, filePath) => {
                res.header(
                    "cache-control",
                    filePath.includes(`${sep}assets${sep}`)
                        ? "public, max-age=31536000, immutable"
                        : "no-cache",
                );
            },
        });

        app.setNotFoundHandler((request, reply) => {
            const path = request.url.split("?")[0]!;
            const isApi = path.startsWith("/api/") || path.startsWith("/ws");
            const isFile = /\.[a-z0-9]+$/i.test(path);
            const isPage = request.method === "GET" && !isApi && !isFile;
            if (isPage) return reply.sendFile("index.html");
            return reply.code(404).send({ error: "Not found" });
        });
    }
    return app;
}
