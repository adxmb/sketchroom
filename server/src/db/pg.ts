import pg from "pg";
import type { Db } from "./types.js";

export function createPgDb(connectionString: string): Db {
    const pool = new pg.Pool({
        connectionString,
        max: 10,
        connectionTimeoutMillis: 10_000,
        idleTimeoutMillis: 30_000,
        keepAlive: true,
    });
    pool.on("error", (err) =>
        console.error("Idle database connection failed:", err.message),
    );
    return {
        async query<T>(text: string, params?: unknown[]) {
            const result = await pool.query(text, params as unknown[]);
            return { rows: result.rows as T[] };
        },
        async exec(sql: string) {
            await pool.query(sql);
        },
        close: () => pool.end(),
    };
}
