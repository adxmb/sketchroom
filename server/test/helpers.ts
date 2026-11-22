import { PGlite } from "@electric-sql/pglite";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import type { Db } from "../src/db/types.js";

/** A real Postgres engine in memory. No Docker needed */
export async function createTestDb(): Promise<Db> {
    const pg = new PGlite();
    const db: Db = {
        async query<T>(text: string, params?: unknown[]) {
            const result = await pg.query(text, params as unknown[]);
            return { rows: result.rows as T[] };
        },
        async exec(sql: string) {
            await pg.exec(sql);
        },
        close: () => pg.close(),
    };
    await migrate(db);
    return db;
}

export async function createTestApp(
    overrides: { authRateLimit?: number } = {},
) {
    const db = await createTestDb();
    const app = await buildApp({
        db,
        authRateLimit: overrides.authRateLimit ?? 1000,
    });
    return { app, db };
}
