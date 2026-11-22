import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { authRoutes } from "./auth/routes.js";
import type { Db } from "./db/types.js";
import { gateway } from "./game/gateway.js";
import { RoomManager } from "./game/rooms.js";

export interface AppOptions {
    db: Db;
    /** Send cookies only over HTTPS. Turn on in prod */
    secureCookies?: boolean;
    /** Trust X-Forwarded-For. Turn on behind a proxy such as Render */
    trustProxy?: boolean;
    authRateLimit?: number;
    /** Where else can open a ws */
    allowedOrigins?: string[];
    rooms?: RoomManager;
    messagesPerSecond?: number;
    createRoomLimit?: number;
    logger?: boolean;
}

export async function buildApp(opts: AppOptions) {
    const app = Fastify({
        logger: opts.logger ?? false,
        trustProxy: opts.trustProxy ?? false,
        bodyLimit: 16 * 1024,
    });
    await app.register(cookie);
    await app.register(rateLimit, { global: false });
    await app.register(authRoutes, {
        db: opts.db,
        secureCookies: opts.secureCookies ?? false,
        authRateLimit: opts.authRateLimit ?? 10,
    });
    await app.register(gateway, {
        db: opts.db,
        rooms: opts.rooms ?? new RoomManager(),
        allowedOrigins: opts.allowedOrigins ?? [],
        messagesPerSecond: opts.messagesPerSecond ?? 30,
        createRoomLimit: opts.createRoomLimit ?? 20,
    });
    app.get("/health", async () => ({ status: "ok" }));
    return app;
}
