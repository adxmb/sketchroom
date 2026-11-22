import { expect, it } from "vitest";
import { migrate } from "../src/db/migrate.js";
import { createTestDb } from "./helpers.js";

it("runs each migration once", async () => {
    const db = await createTestDb(); // already ran once
    expect(await migrate(db)).toEqual([]);
    const { rows } = await db.query<{ name: string }>(
        "select name from schema_migrations",
    );
    expect(rows.map((r) => r.name)).toEqual(["001_users_sessions.sql"]);
    await db.close();
});
