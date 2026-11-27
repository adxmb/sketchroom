import { useState, type SubmitEvent } from "react";
import { useNavigate } from "react-router-dom";
import { roomCodeSchema, type Mode } from "../../../server/src/protocol";
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
    const [mode, setMode] = useState<Mode>("compete");

    const create = async (guestName?: string) => {
        setCreateError(null);
        if (guestName) saveGuestName(guestName);
        const res = await api.createRoom(mode);
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
            </header>
            <section className="card">
                <h2>Start a room</h2>
                {session.loading ? null : session.user ? (
                    <div className="stack">
                        <p className="muted">
                            You will play as {session.user.username}
                        </p>
                        <ModePicker mode={mode} onChange={setMode} />
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
                    >
                        <ModePicker mode={mode} onChange={setMode} />
                    </NameForm>
                )}
                {createError && (
                    <p className="error" role="alert">
                        {createError}
                    </p>
                )}
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

const MODES: { mode: Mode; title: string; text: string; ready: boolean }[] = [
    {
        mode: "compete",
        title: "Compete",
        text: "One player draws a secret word. The others guess it.",
        ready: true,
    },
    {
        mode: "teams",
        title: "Teams",
        text: "Two teams. One team draws together. The other team guesses. Coming soon.",
        ready: false,
    },
    {
        mode: "collab",
        title: "Collab",
        text: "A shared whiteboard for 2 to 8 players. No score, no word.",
        ready: true,
    },
];

function ModePicker({
    mode,
    onChange,
}: {
    mode: Mode;
    onChange: (mode: Mode) => void;
}) {
    return (
        <div className="mode-picker" role="group" aria-label="Mode">
            <div className="mode-buttons">
                {MODES.map((m) => (
                    <div key={m.mode} className="mode-item">
                        <button
                            type="button"
                            className={`mode-btn${mode === m.mode ? " on" : ""}`}
                            aria-pressed={mode === m.mode}
                            aria-describedby={`mode-tip-${m.mode}`}
                            disabled={!m.ready}
                            onClick={() => onChange(m.mode)}
                        >
                            {m.title}
                        </button>
                        <span
                            id={`mode-tip-${m.mode}`}
                            role="tooltip"
                            className="mode-tip"
                        >
                            {m.text}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}
