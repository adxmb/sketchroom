import { useEffect, useState } from "react";
import type { LeaderboardRow, Stats } from "../../../server/src/protocol";
import { api, type ApiUser } from "../api";

/** The ten accounts with the most points */
export function Leaderboard() {
    const [rows, setRows] = useState<LeaderboardRow[] | null>(null);

    useEffect(() => {
        let live = true;
        api.leaderboard().then((res) => {
            if (live) setRows(res.ok ? res.data.players : []);
        });
        return () => {
            live = false;
        };
    }, []);

    if (rows === null) return null;
    return (
        <section className="card">
            <h2>Top players</h2>
            {rows.length === 0 ? (
                <p className="muted">
                    No games saved yet. Log in and finish a game to be the
                    first.
                </p>
            ) : (
                <ol className="results">
                    {rows.map((r, i) => (
                        <li key={r.username}>
                            <span className="rank">{i + 1}</span>
                            <span className="player-name">{r.username}</span>
                            <span className="muted small-note">
                                {r.games} {r.games === 1 ? "game" : "games"},{" "}
                                {r.wins} {r.wins === 1 ? "win" : "wins"}
                            </span>
                            <span className="points">{r.totalScore}</span>
                        </li>
                    ))}
                </ol>
            )}
        </section>
    );
}

/** The numbers of the logged-in account */
export function MyStats({ user }: { user: ApiUser }) {
    const [stats, setStats] = useState<Stats | null>(null);

    useEffect(() => {
        let live = true;
        api.stats().then((res) => {
            if (live && res.ok) setStats(res.data.stats);
        });
        return () => {
            live = false;
        };
    }, [user.id]);

    if (!stats) return null;
    return (
        <p className="muted small-note">
            {stats.games} {stats.games === 1 ? "game" : "games"} played,{" "}
            {stats.wins} {stats.wins === 1 ? "win" : "wins"}, best score{" "}
            {stats.bestScore}
        </p>
    );
}
