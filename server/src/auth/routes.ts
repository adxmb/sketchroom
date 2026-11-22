import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { Db } from "../db/types.js";
import { burnTime, hashPassword, verifyPassword } from "./passwords.js";
import {
    SESSION_COOKIE,
    SESSION_DAYS,
    createSession,
    deleteSession,
    getUserByToken,
} from "./sessions.js";

const credentials = z.object({
    username: z
        .string()
        .min(3, "Username must have 3 to 20 characters")
        .max(20, "Username must have 3 to 20 characters")
        .regex(
            /^[A-Za-z0-9_]+$/,
            "Username can only contain letters, numbers, and underscores",
        ),
    password: z
        .string()
        .min(8, "Password must have at least 8 characters")
        .max(128, "Password must have at most 128 characters"),
});

export interface AuthOptions {
    db: Db;
    secureCookies: boolean;
    /** Requests each IP can make to register or log in, each minute */
    authRateLimit: number;
}

export async function authRoutes(app: FastifyInstance, opts: AuthOptions) {
    const { db } = opts;
    const limited = {
        config: {
            rateLimit: { max: opts.authRateLimit, timeWindow: "1 minute" },
        },
    };

    function startSession(reply: FastifyReply, token: string) {
        reply.setCookie(SESSION_COOKIE, token, {
            httpOnly: true,
            sameSite: "lax",
            secure: opts.secureCookies,
            path: "/",
            maxAge: SESSION_DAYS * 24 * 60 * 60,
        });
    }

    app.post("/api/auth/register", limited, async (request, reply) => {
        const parsed = credentials.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({
                error: parsed.error.issues[0]?.message ?? "Invalid input",
            });
        }
        const { username, password } = parsed.data;
        const passwordHash = await hashPassword(password);
        const { rows } = await db.query<{ id: number }>(
            `insert into users (username, password_hash) values ($1, $2)
            on conflict ((lower(username))) do nothing
            returning id`,
            [username, passwordHash],
        );
        const row = rows[0];
        if (!row) return reply.code(409).send({ error: "Username is taken" });
        startSession(reply, await createSession(db, row.id));
        return reply.code(201).send({ user: { id: row.id, username } });
    });

    app.post("/api/auth/login", limited, async (request, reply) => {
        const parsed = credentials.safeParse(request.body);
        // Same answer for a bad format, unknown name, and wrong password
        const fail = () =>
            reply.code(401).send({ error: "Wrong username or password" });
        if (!parsed.success) return fail();
        const { username, password } = parsed.data;
        const { rows } = await db.query<{
            id: number;
            username: string;
            password_hash: string;
        }>(
            "select id, username, password_hash from users where lower(username) = lower($1)",
            [username],
        );
        const user = rows[0];
        if (!user) {
            await burnTime(password);
            return fail();
        }
        if (!(await verifyPassword(user.password_hash, password)))
            return fail();
        startSession(reply, await createSession(db, user.id));
        return { user: { id: user.id, username: user.username } };
    });

    app.post("/api/auth/logout", async (request, reply) => {
        await deleteSession(db, request.cookies[SESSION_COOKIE]);
        reply.clearCookie(SESSION_COOKIE, { path: "/" });
        return reply.code(204).send();
    });

    app.get("/api/auth/me", async (request, reply) => {
        const user = await getUserByToken(db, request.cookies[SESSION_COOKIE]);
        if (!user) return reply.code(401).send({ error: "Not logged in" });
        return { user };
    });
}
