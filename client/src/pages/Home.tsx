import { useState, type SubmitEvent } from "react";
import { useNavigate } from "react-router-dom";
import { roomCodeSchema } from "../../../server/src/protocol";
import { api } from "../api";
import { AuthBox } from "../components/AuthBox";
import { NameForm } from "../components/NameForm";
import { loadGuestName, saveGuestName } from "../guestName";
import type { Session } from "../useSession";
import { Leaderboard } from "../components/Leaderboard";

export function Home({ session }: { session: Session }) {
    const navigate = useNavigate();
    const [code, setCode] = useState("");
    const [codeError, setCodeError] = useState<string | null>(null);
    const [createError, setCreateError] = useState<string | null>(null);

    const create = async (guestName?: string) => {
        setCreateError(null);
        if (guestName) saveGuestName(guestName);
        const res = await api.createRoom("compete");
        if (res.ok) navigate(`/r/${res.data.code}`);
        else setCreateError(res.error);
    };

    const join = (e: SubmitEvent<HTMLFormElement>) => {
        e.preventDefault();
        const clean = code.trim().toUpperCase();
        if (!roomCodeSchema.safeParse(clean).success) {
            setCodeError("A room code has 5 alpha-numeric characters");
            return;
        }
        navigate(`/r/${clean}`);
    };

    return (
        <>
            <header>
                <h1>SketchRoom</h1>
                <p className="lead">Draw a word. The others guess!</p>
            </header>
            <section className="card">
                <h2>Start a room</h2>
                {session.loading ? null : session.user ? (
                    <div className="stack">
                        <p className="muted">
                            You will play as {session.user.username}
                        </p>
                        <button
                            className="btn primary"
                            onClick={() => create()}
                        >
                            Create room
                        </button>
                    </div>
                ) : (
                    <NameForm
                        initial={loadGuestName()}
                        button="Create room"
                        onSubmit={create}
                    />
                )}
                <p className="muted small-note">
                    Mode: compete (collab coming soon...)
                </p>
            </section>

            <section className="card">
                <h2>Join a room</h2>
                <form onSubmit={join} className="stack">
                    <label>
                        Room code
                        <input
                            value={code}
                            onChange={(e) =>
                                setCode(e.target.value.toUpperCase())
                            }
                            maxLength={5}
                            autoComplete="off"
                            className="code-input"
                            placeholder="ABCDE"
                        />
                    </label>
                    {codeError && (
                        <p className="error" role="alert">
                            {codeError}
                        </p>
                    )}
                    <button className="btn">Join</button>
                </form>
            </section>

            <AuthBox session={session} />
            <Leaderboard />
        </>
    );
}
