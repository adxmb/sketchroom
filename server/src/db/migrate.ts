import { readdir, readFile } from "node:fs/promises";
import type { Db } from "./types.js";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);

/** Run every migration file that has not yet run in name order */
export async function migrate(db: Db): Promise<string[]> {
    await db.exec(`create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()    
    )`);
    const done = new Set(
        (
            await db.query<{ name: string }>(
                "select name from schema_migrations",
            )
        ).rows.map((r) => r.name),
    );
    const files = (await readdir(MIGRATIONS_DIR))
        .filter((f: string) => f.endsWith(".sql"))
        .sort();
    const applied: string[] = [];

    for (const file of files) {
        if (done.has(file)) continue;
        const sql = await readFile(new URL(file, MIGRATIONS_DIR), "utf8");
        // One string with several statements runs as one transaction on Postgres, so a failed migration leaves no trace
        // (Separate begin/commit calls would not work with a connection pool, which can use a new connection for each call)
        const record = `insert into schema_migrations (name) values ('${file.replace(/'/g, "''")}')`;
        await db.exec(`${sql}\n;\n${record};`);
        applied.push(file);
    }

    return applied;
}
