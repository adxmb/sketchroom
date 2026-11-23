import type { GameView, RoomView } from "../../../server/src/protocol";
import { secondsLeft, useCountdown } from "../countdown";
import { PlayerList } from "./PlayerList";

export function GameScreen({
    room,
    game,
    myId,
}: {
    room: RoomView;
    game: GameView;
    myId: string | null;
}) {
    const ms = useCountdown(game.msLeft, room);
    const drawer = room.players.find((p) => p.id === game.drawerId);
    const iDraw = game.drawerId === myId;
    const reveal = game.phase === "reveal";

    return (
        <>
            <section className="card">
                <div className="row">
                    <p className="eyebrow">
                        Turn {game.turn} of {game.totalTurns}
                    </p>
                    <p
                        className="timer"
                        aria-labal={`${secondsLeft(ms)} seconds left`}
                    >
                        {secondsLeft(ms)}s
                    </p>
                </div>
                {reveal ? (
                    <>
                        <p className="muted">The word was</p>
                        <p className="word">{game.word}</p>
                    </>
                ) : iDraw ? (
                    <>
                        <p className="muted">Draw this word...</p>
                        <p className="word">{game.word}</p>
                    </>
                ) : (
                    <>
                        <p className="muted">
                            {drawer?.name ?? "A player"} is drawing. Guess the
                            word...
                        </p>
                        <p
                            className="word hint"
                            aria-label={`${game.hint.replace(/ /g, "").length} letters`}
                        >
                            {game.hint}
                        </p>
                    </>
                )}
            </section>

            <section className="card board" aria-label="Drawing board">
                <p className="muted">Drawing board comes next</p>
            </section>

            <section className="card">
                <h2>
                    Players{" "}
                    <span className="muted">({room.players.length})</span>
                </h2>
                <PlayerList room={room} myId={myId} />
            </section>
        </>
    );
}
