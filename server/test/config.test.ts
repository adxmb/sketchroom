import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const base = { DATABASE_URL: "postgres://u:p@localhost:5432/db" };

describe("loadConfig", () => {
    it("has safe defaults", () => {
        expect(loadConfig(base)).toEqual({
            databaseUrl: "postgres://u:p@localhost:5432/db",
            port: 3000,
            host: "0.0.0.0",
            allowedOrigins: [],
            secureCookies: false,
            trustProxy: false,
            staticDir: null,
            debugIp: false,
        });
    });

    it("needs a database address", () => {
        expect(() => loadConfig({})).toThrow("DATABASE_URL is not set");
        expect(() => loadConfig({ DATABASE_URL: "  " })).toThrow(
            "DATABASE_URL is not set",
        );
    });

    it("reads the port, and refuses a port that is not a number", () => {
        expect(loadConfig({ ...base, PORT: "10000" }).port).toBe(10000);
        expect(() => loadConfig({ ...base, PORT: "abc" })).toThrow(
            "PORT must be",
        );
        expect(() => loadConfig({ ...base, PORT: "70000" })).toThrow(
            "PORT must be",
        );
        expect(() => loadConfig({ ...base, PORT: "-1" })).toThrow(
            "PORT must be",
        );
        expect(loadConfig({ ...base, PORT: "" }).port).toBe(3000);
    });

    it("turns secure cookies on in production, unless the setting says no", () => {
        expect(
            loadConfig({ ...base, NODE_ENV: "production" }).secureCookies,
        ).toBe(true);
        expect(
            loadConfig({
                ...base,
                NODE_ENV: "production",
                SECURE_COOKIES: "false",
            }).secureCookies,
        ).toBe(false);
        expect(
            loadConfig({ ...base, SECURE_COOKIES: "true" }).secureCookies,
        ).toBe(true);
        expect(() => loadConfig({ ...base, SECURE_COOKIES: "yes" })).toThrow(
            "SECURE_COOKIES must be",
        );
    });

    it("splits the list of origins and drops empty parts", () => {
        expect(
            loadConfig({
                ...base,
                ALLOWED_ORIGINS: " https://a.com, ,https://b.com ",
            }).allowedOrigins,
        ).toEqual(["https://a.com", "https://b.com"]);
    });

    it("keeps the proxy list as text, and trusts no proxy when it is empty", () => {
        expect(
            loadConfig({ ...base, TRUST_PROXY: "loopback, uniquelocal" })
                .trustProxy,
        ).toBe("loopback, uniquelocal");
        expect(loadConfig({ ...base, TRUST_PROXY: " " }).trustProxy).toBe(
            false,
        );
    });

    it("reads the folder of the client and the debug switch", () => {
        const c = loadConfig({
            ...base,
            STATIC_DIR: "/app/client/dist",
            DEBUG_IP: "1",
            HOST: "127.0.0.1",
        });
        expect(c).toMatchObject({
            staticDir: "/app/client/dist",
            debugIp: true,
            host: "127.0.0.1",
        });
        expect(loadConfig({ ...base, DEBUG_IP: "true" }).debugIp).toBe(false);
    });
});
