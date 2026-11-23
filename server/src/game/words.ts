import type { Db } from "../db/types.js";

/** Pick random words from database */
export async function pickWords(db: Db, count: number): Promise<string[]> {
    const { rows } = await db.query<{ text: string }>(
        "select text from words order by random() limit $1",
        [count],
    );
    return rows.map((r) => r.text);
}
