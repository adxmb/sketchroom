import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { Db } from "../src/db/types.js";
import type { FinishedGame } from "../src/game/rooms.js";
import { getLeaderboard, getStats, saveGame } from "../src/stats.js";
import { createTestDb } from "./helpers.js";

let db: Db | undefined;
afterEach(async () => {
    await db?.close();
    db = undefined;
});

async function addUser(name: string): Promise<number> {
    const { rows } = await db!.query<{ id: number }>(
        "insert into users (username, password_hash) values ($1, 'x') returning id",
        [name],
    );
    return rows[0]!.id;
}

const game = (players: FinishedGame["players"]): FinishedGame => ({
    code: "ABCDE",
    rounds: 2,
    players,
});

describe("saveGame", () => {
    it("saves the accounts and skips the guests", async () => {
        db = await createTestDb();
        const ann = await addUser("ann");
        await saveGame(
            db,
            game([
                { userId: ann, name: "ann", score: 700, rank: 1 },
                { userId: null, name: "guest", score: 400, rank: 2 },
            ]),
        );
        const games = await db.query(
            "select room_code, rounds, player_count from games",
        );
        expect(games.rows).toEqual([
            { room_code: "ABCDE", rounds: 2, player_count: 2 },
        ]);
        const rows = await db.query(
            "select user_id, score, rank from game_players",
        );
        expect(rows.rows).toEqual([{ user_id: ann, score: 700, rank: 1 }]);
    });

    it("saves nothing when the game has only guests", async () => {
        db = await createTestDb();
        await saveGame(
            db,
            game([
                { userId: null, name: "a", score: 1, rank: 1 },
                { userId: null, name: "b", score: 0, rank: 2 },
            ]),
        );
        expect((await db.query("select 1 from games")).rows).toHaveLength(0);
    });

    it("saves several accounts with their own scores and ranks", async () => {
        db = await createTestDb();
        const ann = await addUser("ann");
        const bob = await addUser("bob");
        await saveGame(
            db,
            game([
                { userId: bob, name: "bob", score: 900, rank: 1 },
                { userId: ann, name: "ann", score: 300, rank: 2 },
            ]),
        );
        const rows = await db.query(
            "select user_id, score, rank from game_players order by rank",
        );
        expect(rows.rows).toEqual([
            { user_id: bob, score: 900, rank: 1 },
            { user_id: ann, score: 300, rank: 2 },
        ]);
    });

    it("removes the games of an account when the account is deleted", async () => {
        db = await createTestDb();
        const ann = await addUser("ann");
        await saveGame(
            db,
            game([
                { userId: ann, name: "ann", score: 5, rank: 1 },
                { userId: null, name: "b", score: 0, rank: 2 },
            ]),
        );
        await db.query("delete from users where id = $1", [ann]);
        expect(
            (await db.query("select 1 from game_players")).rows,
        ).toHaveLength(0);
    });
});

describe("getStats", () => {
    it("is 0 for an account without games", async () => {
        db = await createTestDb();
        const ann = await addUser("ann");
        expect(await getStats(db, ann)).toEqual({
            games: 0,
            wins: 0,
            bestScore: 0,
            totalScore: 0,
        });
    });

    it("adds up the games of one account", async () => {
        db = await createTestDb();
        const ann = await addUser("ann");
        const bob = await addUser("bob");
        await saveGame(
            db,
            game([
                { userId: ann, name: "ann", score: 700, rank: 1 },
                { userId: bob, name: "bob", score: 300, rank: 2 },
            ]),
        );
        await saveGame(
            db,
            game([
                { userId: ann, name: "ann", score: 200, rank: 2 },
                { userId: bob, name: "bob", score: 800, rank: 1 },
            ]),
        );
        await saveGame(
            db,
            game([
                { userId: ann, name: "ann", score: 500, rank: 1 },
                { userId: null, name: "g", score: 100, rank: 2 },
            ]),
        );
        expect(await getStats(db, ann)).toEqual({
            games: 3,
            wins: 2,
            bestScore: 700,
            totalScore: 1400,
        });
        expect(await getStats(db, bob)).toEqual({
            games: 2,
            wins: 1,
            bestScore: 800,
            totalScore: 1100,
        });
    });
});

describe("getLeaderboard", () => {
    it("is empty without games", async () => {
        db = await createTestDb();
        expect(await getLeaderboard(db)).toEqual([]);
    });

    it("sorts by total score, then by fewer games", async () => {
        db = await createTestDb();
        const ann = await addUser("ann");
        const bob = await addUser("bob");
        const cat = await addUser("cat");
        await saveGame(
            db,
            game([
                { userId: ann, name: "ann", score: 500, rank: 1 },
                { userId: bob, name: "bob", score: 400, rank: 2 },
            ]),
        );
        await saveGame(
            db,
            game([
                { userId: bob, name: "bob", score: 100, rank: 2 },
                { userId: cat, name: "cat", score: 500, rank: 1 },
            ]),
        );
        const board = await getLeaderboard(db);
        // ann 500 in 1 game, bob 500 in 2 games, cat 500 in 1 game. Fewer games first, then by name
        expect(board).toEqual([
            { username: "ann", totalScore: 500, games: 1, wins: 1 },
            { username: "cat", totalScore: 500, games: 1, wins: 1 },
            { username: "bob", totalScore: 500, games: 2, wins: 0 },
        ]);
    });

    it("shows ten accounts at most", async () => {
        db = await createTestDb();
        for (let i = 0; i < 12; i++) {
            const id = await addUser(`user${i}`);
            await saveGame(
                db,
                game([
                    { userId: id, name: `user${i}`, score: 100 + i, rank: 1 },
                    { userId: null, name: "g", score: 0, rank: 2 },
                ]),
            );
        }
        const board = await getLeaderboard(db);
        expect(board).toHaveLength(10);
        expect(board[0]!.username).toBe("user11");
    });
});

describe("routes", () => {
    it("shows the leaderboard to everyone", async () => {
        db = await createTestDb();
        const app = await buildApp({ db });
        const id = await addUser("ann");
        await saveGame(
            db,
            game([
                { userId: id, name: "ann", score: 450, rank: 1 },
                { userId: null, name: "g", score: 0, rank: 2 },
            ]),
        );
        const res = await app.inject({
            method: "GET",
            url: "/api/leaderboard",
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            players: [{ username: "ann", totalScore: 450, games: 1, wins: 1 }],
        });
        await app.close();
    });

    it("shows the stats only to the account", async () => {
        db = await createTestDb();
        const app = await buildApp({ db, authRateLimit: 1000 });
        expect(
            (await app.inject({ method: "GET", url: "/api/stats" })).statusCode,
        ).toBe(401);
        expect(
            (
                await app.inject({
                    method: "GET",
                    url: "/api/stats",
                    cookies: { sid: "false" },
                })
            ).statusCode,
        ).toBe(401);

        const reg = await app.inject({
            method: "POST",
            url: "/api/auth/register",
            payload: { username: "ann_1", password: "correct horse" },
        });
        const sid = reg.cookies.find((c) => c.name === "sid")!.value;
        const userId = reg.json().user.id as number;
        await saveGame(
            db,
            game([
                { userId, name: "ann_1", score: 640, rank: 1 },
                { userId: null, name: "g", score: 0, rank: 2 },
            ]),
        );
        const res = await app.inject({
            method: "GET",
            url: "/api/stats",
            cookies: { sid },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            stats: { games: 1, wins: 1, bestScore: 640, totalScore: 640 },
        });
        await app.close();
    });
});
