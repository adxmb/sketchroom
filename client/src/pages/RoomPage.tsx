import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { roomCodeSchema } from "../../../server/src/protocol";
import { NameForm, checkName } from "../components/NameForm";
import { GameScreen } from "../components/GameScreen";
import { PlayerList } from "../components/PlayerList";
import { loadGuestName, saveGuestName } from "../guestName";
import { useRoom } from "../useRoom";
import type { Session } from "../useSession";

export function RoomPage({ session }: { session: Session }) {
    const { code = "" } = useParams();
    const [guestName, setGuestName] = useState<string>(() => {
        const saved = loadGuestName();
        return checkName(saved) ? "" : saved;
    });

    if (!roomCodeSchema.safeParse(code).success) {
        return (
            <section className="card">
                <h2>Invalid room code</h2>
                <Link to="/">Back to start</Link>
            </section>
        );
    }
    if (session.loading) return <p className="muted">Loading...</p>;

    if (!session.user && !guestName) {
        return (
            <section className="card">
                <h2>Join room {code}</h2>
                <NameForm
                    initial=""
                    button="Join"
                    onSubmit={(name) => {
                        saveGuestName(name);
                        setGuestName(name);
                    }}
                />
            </section>
        );
    }

    return (
        <Lobby
            code={code}
            name={session.user ? null : guestName}
            isGuest={!session.user}
            onChangeName={() => setGuestName("")}
        />
    );
}

function Lobby({
    code,
    name,
    isGuest,
    onChangeName,
}: {
    code: string;
    name: string | null;
    isGuest: boolean;
    onChangeName: () => void;
}) {
    const navigate = useNavigate();
    const { state, leave, startGame, drawLocal, drawSend, undo, clearCanvas } =
        useRoom(code, name);
    const [copied, setCopied] = useState(false);

    const copyLink = async () => {
        try {
            await navigator.clipboard.writeText(window.location.href);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // Copy can be blocked, link stays in the address bar
        }
    };

    const goHome = () => {
        leave();
        navigate("/");
    };

    if (state.status === "error") {
        return (
            <section className="card">
                <h2>Cannot join room {code}</h2>
                <p className="error" role="alert">
                    {state.error}
                </p>
                <div className="row">
                    {isGuest && (
                        <button className="btn primary" onClick={onChangeName}>
                            Change name
                        </button>
                    )}
                    <Link to="/" className="btn">
                        Back to start
                    </Link>
                </div>
            </section>
        );
    }

    if (state.status === "closed") {
        return (
            <section className="card">
                <h2>You left the room</h2>
                <p className="muted">The connection is closed.</p>
                <Link to="/" className="btn primary">
                    Back to start
                </Link>
            </section>
        );
    }

    if (state.status === "connecting" || !state.room)
        return <p className="muted">Connecting...</p>;

    const room = state.room;
    const me = room.players.find((p) => p.id === state.playerId);
    const canStart = !!me?.isHost && room.players.length >= 2;

    return (
        <>
            <header className="lobby-head">
                <div>
                    <p className="eyebrow">Room code</p>
                    <h1
                        className="room-code"
                        aria-label={`Room code ${code.split("").join(" ")}`}
                    >
                        {room.code}
                    </h1>
                </div>
                <div className="row">
                    <button className="btn small" onClick={copyLink}>
                        {copied ? "Copied" : "Copy link"}
                    </button>
                    <button className="btn small" onClick={goHome}>
                        Leave
                    </button>
                </div>
            </header>

            {state.error && (
                <p className="error" role="alert">
                    {state.error}
                </p>
            )}

            {room.game ? (
                <GameScreen
                    room={room}
                    game={room.game}
                    myId={state.playerId}
                    board={{
                        strokes: state.strokes,
                        onLocal: drawLocal,
                        onSend: drawSend,
                        onUndo: undo,
                        onClear: clearCanvas,
                    }}
                />
            ) : (
                <>
                    <section className="card">
                        <h2>
                            Players{" "}
                            <span className="muted">
                                ({room.players.length})
                            </span>
                        </h2>
                        <PlayerList room={room} myId={state.playerId} />
                    </section>

                    <section className="card">
                        <button
                            className="btn primary"
                            disabled={!canStart}
                            onClick={startGame}
                        >
                            Start game
                        </button>
                        <p className="muted small-note">
                            {!me?.isHost
                                ? "Waiting for the host to start the game."
                                : room.players.length < 2
                                  ? "You need at least 2 players. Share the room code."
                                  : "Everyone draws a word. The others guess it."}
                        </p>
                    </section>
                </>
            )}
        </>
    );
}
