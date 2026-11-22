import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../db/types.js";

export const SESSION_COOKIE = "sid";
export const SESSION_DAYS = 14;

export interface User {
    id: number;
    username: string;
}

const sha256 = (value: string) =>
    createHash("sha256").update(value).digest("hex");

/** Make a session. Return the token for the cookie. Only hash goes in db */
export async function createSession(db: Db, userId: number): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await db.query(
        `insert into sessions (token_hash, user_id, expires_at)
        values ($1, $2, now() + make_interval(days => $3))`,
        [sha256(token), userId, SESSION_DAYS],
    );
    return token;
}

export async function getUserByToken(
    db: Db,
    token: string | undefined,
): Promise<User | null> {
    if (!token) return null;
    const { rows } = await db.query<User>(
        `select u.id, u.username
            from sessions s join users u on u.id = s.user_id
            where s.token_hash = $1 and s.expires_at > now()`,
        [sha256(token)],
    );
    return rows[0] ?? null;
}

export async function deleteSession(
    db: Db,
    token: string | undefined,
): Promise<void> {
    if (!token) return;
    await db.query("delete from sessions where token_hash = $1", [
        sha256(token),
    ]);
}

export async function deleteExpiredSessions(db: Db): Promise<void> {
    await db.query("delete from sessions where expires_at <= now()");
}
