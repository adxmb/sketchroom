import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { Db } from "../src/db/types.js";
import { createTestDb } from "./helpers.js";

let db: Db | undefined;
let dir: string;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sketchroom-static-"));
    await mkdir(join(dir, "assets"));
    await writeFile(
        join(dir, "index.html"),
        "<!doctype html><title>Sketchroom</title><div id=root></div>",
    );
    await writeFile(
        join(dir, "assets", "index-abc123.js"),
        "console.log('app')",
    );
});

afterEach(async () => {
    await db?.close();
    db = undefined;
    await rm(dir, { recursive: true, force: true });
});

async function app(
    opts: {
        staticDir?: string | null;
        debugIp?: boolean;
        trustProxy?: string | false;
    } = {},
) {
    db = await createTestDb();
    return buildApp({ db, staticDir: dir, ...opts });
}

describe("serving the client", () => {
    it("serves the home page", async () => {
        const a = await app();
        const res = await a.inject({ method: "GET", url: "/" });
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-type"]).toContain("text/html");
        expect(res.body).toContain("Sketchroom");
        expect(res.headers["cache-control"]).toBe("no-cache");
        await a.close();
    });

    it("serves files with a hash in the name, and lets a browser keep them", async () => {
        const a = await app();
        const res = await a.inject({
            method: "GET",
            url: "/assets/index-abc123.js",
        });
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-type"]).toContain("javascript");
        expect(res.headers["cache-control"]).toBe(
            "public, max-age=31536000, immutable",
        );
        await a.close();
    });

    it("gives the app for a page address that has no file, so a link to a room works", async () => {
        const a = await app();
        for (const url of ["/r/ABCDE", "/r/ABCDE?x=1", "/some/other/page"]) {
            const res = await a.inject({ method: "GET", url });
            expect(res.statusCode, url).toBe(200);
            expect(res.body, url).toContain("<div id=root>");
        }
        await a.close();
    });

    it("gives a real 404 for a missing file, an unknown API address, and a POST", async () => {
        const a = await app();
        expect(
            (await a.inject({ method: "GET", url: "/assets/missing.js" }))
                .statusCode,
        ).toBe(404);
        expect(
            (await a.inject({ method: "GET", url: "/favicon.ico" })).statusCode,
        ).toBe(404);
        const api = await a.inject({ method: "GET", url: "/api/nothing" });
        expect(api.statusCode).toBe(404);
        expect(api.json()).toEqual({ error: "Not found" });
        expect(
            (await a.inject({ method: "POST", url: "/r/ABCDE" })).statusCode,
        ).toBe(404);
        await a.close();
    });

    it("does not stop the API routes", async () => {
        const a = await app();
        expect(
            (await a.inject({ method: "GET", url: "/health" })).json(),
        ).toEqual({ status: "ok" });
        expect(
            (await a.inject({ method: "GET", url: "/api/leaderboard" }))
                .statusCode,
        ).toBe(200);
        expect(
            (await a.inject({ method: "POST", url: "/api/guest" })).statusCode,
        ).toBe(204);
        await a.close();
    });

    it("does not let a request read a file outside the folder", async () => {
        const a = await app();
        const res = await a.inject({
            method: "GET",
            url: "/../../../etc/passwd",
        });
        expect(res.body).not.toContain("root:");
        const encoded = await a.inject({
            method: "GET",
            url: "/%2e%2e/%2e%2e/etc/passwd",
        });
        expect(encoded.body).not.toContain("root:");
        await a.close();
    });

    it("has no client files when no folder is set", async () => {
        const a = await app({ staticDir: null });
        expect((await a.inject({ method: "GET", url: "/" })).statusCode).toBe(
            404,
        );
        await a.close();
    });
});

describe("security headers", () => {
    it("are on pages, files, API answers and errors", async () => {
        const a = await app();
        for (const url of [
            "/",
            "/assets/index-abc123.js",
            "/health",
            "/api/nothing",
        ]) {
            const res = await a.inject({ method: "GET", url });
            expect(res.headers["x-content-type-options"], url).toBe("nosniff");
            expect(res.headers["x-frame-options"], url).toBe("DENY");
            expect(res.headers["referrer-policy"], url).toBe("no-referrer");
            expect(res.headers["content-security-policy"], url).toContain(
                "default-src 'self'",
            );
            expect(res.headers["content-security-policy"], url).toContain(
                "frame-ancestors 'none'",
            );
        }
        await a.close();
    });
});

describe("debug address route", () => {
    it("is not there by default", async () => {
        const a = await app();
        // The answer is the app page, not JSON
        const res = await a.inject({ method: "GET", url: "/debug/ip" });
        expect(res.headers["content-type"]).toContain("text/html");
        await a.close();
    });

    it("shows the address and the header when it is on", async () => {
        const a = await app({ debugIp: true });
        const res = await a.inject({
            method: "GET",
            url: "/debug/ip",
            headers: { "x-forwarded-for": "203.0.113.9" },
            remoteAddress: "10.1.2.3",
        });
        expect(res.json()).toEqual({
            ip: "10.1.2.3",
            forwardedFor: "203.0.113.9",
        });
        await a.close();
    });

    it("trusts the header only from a proxy in the list", async () => {
        const a = await app({ debugIp: true, trustProxy: "uniquelocal" });
        const fromProxy = await a.inject({
            method: "GET",
            url: "/debug/ip",
            headers: { "x-forwarded-for": "203.0.113.9" },
            remoteAddress: "10.1.2.3",
        });
        expect(fromProxy.json().ip).toBe("203.0.113.9");
        // A client with a public address sets the header itself. The server must not believe it
        const direct = await a.inject({
            method: "GET",
            url: "/debug/ip",
            headers: { "x-forwarded-for": "1.2.3.4" },
            remoteAddress: "198.51.100.7",
        });
        expect(direct.json().ip).toBe("198.51.100.7");
        await a.close();
    });
});
