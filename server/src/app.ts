import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { authRoutes } from "./auth/routes.js";
import type { Db } from "./db/types.js";

export interface AppOptions {
    db: Db;
    /** Send cookies only over HTTPS. Turn on in prod */
    secureCookies?: boolean;
    /** Trust X-Forwarded-For. Turn on behind a proxy such as Render */
    trustProxy?: boolean;
    authRateLimit?: number;
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
    app.get("/health", async () => ({ status: "ok" }));
    return app;
}
