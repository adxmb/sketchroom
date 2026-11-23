import type { FastifyInstance } from "fastify";
import { SESSION_COOKIE, getUserByToken } from "./auth/sessions.js";
import type { Db } from "./db/types.js";
import type { FinishedGame } from "./game/rooms.js";
import type { LeaderboardRow, Stats } from "./protocol.js";

/** Save a finished game for the accounts in it. Guests are not saved. One statement, so it is all or nothing */
export async function saveGame(db: Db, game: FinishedGame): Promise<void> {
    const accounts = game.players.filter((p) => p.userId !== null);
    if (accounts.length === 0) return;
    await db.query(
        `with g as (
       insert into games (room_code, rounds, player_count) values ($1, $2, $3) returning id
     )
     insert into game_players (game_id, user_id, score, rank)
     select g.id, x.user_id, x.score, x.rank
     from g, unnest($4::int[], $5::int[], $6::int[]) as x(user_id, score, rank)`,
        [
            game.code,
            game.rounds,
            game.players.length,
            accounts.map((p) => p.userId),
            accounts.map((p) => p.score),
            accounts.map((p) => p.rank),
        ],
    );
}

export async function getStats(db: Db, userId: number): Promise<Stats> {
    const { rows } = await db.query<Stats>(
        `select count(*)::int as games,
            (count(*) filter (where rank = 1))::int as wins,
            coalesce(max(score), 0)::int as "bestScore",
            coalesce(sum(score), 0)::int as "totalScore"
     from game_players where user_id = $1`,
        [userId],
    );
    return rows[0] ?? { games: 0, wins: 0, bestScore: 0, totalScore: 0 };
}

/** The ten accounts with the most points */
export async function getLeaderboard(db: Db): Promise<LeaderboardRow[]> {
    const { rows } = await db.query<LeaderboardRow>(
        `select u.username,
            sum(gp.score)::int as "totalScore",
            count(*)::int as games,
            (count(*) filter (where gp.rank = 1))::int as wins
     from game_players gp
     join users u on u.id = gp.user_id
     group by u.id, u.username
     order by "totalScore" desc, games asc, lower(u.username) asc
     limit 10`,
    );
    return rows;
}

export async function statsRoutes(app: FastifyInstance, opts: { db: Db }) {
    const { db } = opts;
    const limited = {
        config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    };

    app.get("/api/leaderboard", limited, async () => ({
        players: await getLeaderboard(db),
    }));

    app.get("/api/stats", limited, async (request, reply) => {
        const user = await getUserByToken(db, request.cookies[SESSION_COOKIE]);
        if (!user) return reply.code(401).send({ error: "Not logged in" });
        return { stats: await getStats(db, user.id) };
    });
}
