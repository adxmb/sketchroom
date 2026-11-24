import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";

export const GUEST_COOKIE = "gid";

const GUEST_DAYS = 1;

export function isGuestId(value: unknown): value is string {
    return typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
}

export async function guestRoutes(
    app: FastifyInstance,
    opts: { secureCookies: boolean },
) {
    app.post(
        "/api/guest",
        { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
        async (request, reply) => {
            if (!isGuestId(request.cookies[GUEST_COOKIE])) {
                reply.setCookie(GUEST_COOKIE, randomBytes(16).toString("hex"), {
                    httpOnly: true,
                    sameSite: "lax",
                    secure: opts.secureCookies,
                    path: "/",
                    maxAge: GUEST_DAYS * 24 * 60 * 60,
                });
            }
            return reply.code(204).send();
        },
    );
}
