import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { roomCodeSchema } from "../../../server/src/protocol";
import { NameForm, checkName } from "../components/NameForm";
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
                    onSumbit={(name) => {
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
    const { state, leave } = useRoom(code, name);
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

    const me = state.room.players.find((p) => p.id === state.playerId);

    return (
        <>
            <header className="lobby-head">
                <div>
                    <p className="eyebrow">Room code</p>
                    <h1
                        className="room-code"
                        aria-label={`Room code ${code.split("").join(" ")}`}
                    >
                        {state.room.code}
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

            <section className="card">
                <h2>
                    Players{" "}
                    <span className="muted">({state.room.players.length})</span>
                </h2>
                <ul className="players">
                    {state.room.players.map((p) => (
                        <li key={p.id}>
                            <span className="avatar" aria-hidden="true">
                                {p.name.slice(0, 1).toUpperCase()}
                            </span>
                            <span className="player-name">{p.name}</span>
                            {p.id === me?.id && (
                                <span className="badge">You</span>
                            )}
                            {p.isHost && (
                                <span className="badge host">Host</span>
                            )}
                            {p.isGuest && (
                                <span className="badge quiet">Guest</span>
                            )}
                        </li>
                    ))}
                </ul>
            </section>

            <section className="card">
                <button className="btn primary" disabled>
                    Start game
                </button>
                <p className="muted small-note">
                    {me?.isHost
                        ? "You are the host. "
                        : "Waiting for the host. "}
                    The game itself comes next.
                </p>
            </section>
        </>
    );
}
