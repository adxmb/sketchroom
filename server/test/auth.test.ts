import { afterEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/types.js";
import { createTestApp } from "./helpers.js";

type TestApp = Awaited<ReturnType<typeof createTestApp>>["app"];

let app: TestApp;
let db: Db;

afterEach(async () => {
    await app.close();
    await db.close();
});

async function setup(overrides = {}) {
    ({ app, db } = await createTestApp(overrides));
}

const post = (url: string, payload: unknown, cookie?: string) =>
    app.inject({
        method: "POST",
        url,
        payload: payload as object,
        headers: cookie ? { cookie } : {},
    });

/** Return "sid=<token>" from a Set-Cookie header */
function sessionCookie(res: { cookies: { name: string; value: string }[] }) {
    const c = res.cookies.find((x) => x.name === "sid");
    return c ? `sid=${c.value}` : undefined;
}

describe("register", () => {
    it("makes a user and starts a session", async () => {
        await setup();
        const res = await post("/api/auth/register", {
            username: "sam_01",
            password: "correct horse",
        });
        expect(res.statusCode).toBe(201);
        expect(res.json().user.username).toBe("sam_01");
        const cookie = res.cookies.find((c) => c.name === "sid");
        expect(cookie?.httpOnly).toBe(true);
        expect(cookie?.sameSite).toBe("Lax");
    });

    it("stores a hash, not the password", async () => {
        await setup();
        await post("/api/auth/register", {
            username: "sam",
            password: "correct horse",
        });
        const { rows } = await db.query<{ password_hash: string }>(
            "select password_hash from users",
        );
        expect(rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
        expect(rows[0]?.password_hash).not.toContain("correct horse");
    });

    it("stores only a hash of the session token", async () => {
        await setup();
        const res = await post("/api/auth/register", {
            username: "sam",
            password: "correct horse",
        });
        const token = sessionCookie(res)!.slice(4);
        const { rows } = await db.query<{ token_hash: string }>(
            "select token_hash from sessions",
        );
        expect(rows[0]?.token_hash).not.toBe(token);
        expect(rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("rejects a taken username, with any letter case", async () => {
        await setup();
        await post("/api/auth/register", {
            username: "Sam",
            password: "correct horse",
        });
        const res = await post("/api/auth/register", {
            username: "sAM",
            password: "another pass",
        });
        expect(res.statusCode).toBe(409);
    });

    it.each([
        [{ username: "ab", password: "correct horse" }],
        [{ username: "has space", password: "correct horse" }],
        [{ username: "a".repeat(21), password: "correct horse" }],
        [{ username: "sam", password: "short" }],
        [{ username: "sam" }],
        [{}],
    ])("rejects bad input %j", async (body) => {
        await setup();
        const res = await post("/api/auth/register", body);
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toBeTypeOf("string");
    });
});

describe("login, me and logout", () => {
    it("logs in, shows the user, then logs out", async () => {
        await setup();
        await post("/api/auth/register", {
            username: "sam",
            password: "correct horse",
        });

        const login = await post("/api/auth/login", {
            username: "SAM",
            password: "correct horse",
        });
        expect(login.statusCode).toBe(200);
        const cookie = sessionCookie(login)!;

        const me = await app.inject({
            method: "GET",
            url: "/api/auth/me",
            headers: { cookie },
        });
        expect(me.statusCode).toBe(200);
        expect(me.json().user.username).toBe("sam");

        const out = await post("/api/auth/logout", {}, cookie);
        expect(out.statusCode).toBe(204);

        const after = await app.inject({
            method: "GET",
            url: "/api/auth/me",
            headers: { cookie },
        });
        expect(after.statusCode).toBe(401);
    });

    it("gives the same answer for a wrong password and an unknown user", async () => {
        await setup();
        await post("/api/auth/register", {
            username: "sam",
            password: "correct horse",
        });
        const wrong = await post("/api/auth/login", {
            username: "sam",
            password: "wrong password",
        });
        const unknown = await post("/api/auth/login", {
            username: "nobody",
            password: "wrong password",
        });
        expect(wrong.statusCode).toBe(401);
        expect(unknown.statusCode).toBe(401);
        expect(wrong.json()).toEqual(unknown.json());
    });

    it("refuses /me without a cookie or with a false token", async () => {
        await setup();
        expect(
            (await app.inject({ method: "GET", url: "/api/auth/me" }))
                .statusCode,
        ).toBe(401);
        const fake = await app.inject({
            method: "GET",
            url: "/api/auth/me",
            headers: { cookie: "sid=abc" },
        });
        expect(fake.statusCode).toBe(401);
    });

    it("refuses an expired session", async () => {
        await setup();
        const reg = await post("/api/auth/register", {
            username: "sam",
            password: "correct horse",
        });
        const cookie = sessionCookie(reg)!;
        await db.exec(
            "update sessions set expires_at = now() - interval '1 minute'",
        );
        const me = await app.inject({
            method: "GET",
            url: "/api/auth/me",
            headers: { cookie },
        });
        expect(me.statusCode).toBe(401);
    });

    it("does not accept a form post", async () => {
        await setup();
        const res = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: "username=sam&password=correct+horse",
            headers: { "content-type": "application/x-www-form-urlencoded" },
        });
        expect(res.statusCode).toBe(415);
    });
});

describe("limits", () => {
    it("limits repeated login attempts", async () => {
        await setup({ authRateLimit: 3 });
        const codes: number[] = [];
        for (let i = 0; i < 5; i++) {
            codes.push(
                (
                    await post("/api/auth/login", {
                        username: "sam",
                        password: "wrong password",
                    })
                ).statusCode,
            );
        }
        expect(codes).toEqual([401, 401, 401, 429, 429]);
    });

    it("rejects a very large body", async () => {
        await setup();
        const res = await post("/api/auth/register", {
            username: "sam",
            password: "x".repeat(20_000),
        });
        expect(res.statusCode).toBe(413);
    });
});

describe("health", () => {
    it("answers", async () => {
        await setup();
        const res = await app.inject({ method: "GET", url: "/health" });
        expect(res.json()).toEqual({ status: "ok" });
    });
});
