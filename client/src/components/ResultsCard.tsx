import type { ResultsView } from "../../../server/src/protocol";

/** The final scores of the last game */
export function ResultsCard({ results }: { results: ResultsView }) {
    return (
        <section className="card">
            <h2>Final scores</h2>
            <ol className="results">
                {results.players.map((p) => (
                    <li
                        key={p.name}
                        className={p.rank === 1 ? "winner" : undefined}
                    >
                        <span className="rank">{p.rank}</span>
                        <span className="player-name">{p.name}</span>
                        {p.isGuest && (
                            <span className="badge quiet">Guest</span>
                        )}
                        <span className="points">{p.score}</span>
                    </li>
                ))}
            </ol>
        </section>
    );
}
