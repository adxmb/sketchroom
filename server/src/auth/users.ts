import type { Db } from "../db/types.js";

/** True if an account has this username (case insensitive) */
export async function isUsernameTaken(db: Db, name: string): Promise<boolean> {
    const { rows } = await db.query(
        "select 1 from users where lower(username) = lower($1)",
        [name],
    );
    return rows.length > 0;
}
