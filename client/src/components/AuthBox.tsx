import { useState, type SubmitEvent } from "react";
import type { Session } from "../useSession";
import { MyStats } from "./Leaderboard";

export function AuthBox({ session }: { session: Session }) {
    const [mode, setMode] = useState<"login" | "register">("login");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    if (session.loading) return null;

    if (session.user) {
        return (
            <section className="card">
                <p className="row">
                    <span>
                        Signed in as <strong>{session.user.username}</strong>
                    </span>
                    <button className="btn small" onClick={session.logout}>
                        Log out
                    </button>
                </p>
                <MyStats user={session.user} />
            </section>
        );
    }

    const submit = async (e: SubmitEvent<HTMLFormElement>) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const message = await (
            mode === "login" ? session.login : session.register
        )(username, password);
        setError(message);
        setBusy(false);
    };

    return (
        <section className="card">
            <h2>{mode === "login" ? "Log in" : "Create an account"}</h2>
            <form onSubmit={submit} className="stack">
                <label>
                    Username
                    <input
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        autoComplete="username"
                        required
                    />
                </label>
                <label>
                    Password
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete={
                            mode === "login"
                                ? "current-password"
                                : "new-password"
                        }
                        required
                    />
                </label>
                {error && (
                    <p className="error" role="alert">
                        {error}
                    </p>
                )}
                <div className="row">
                    <button className="btn primary" disabled={busy}>
                        {mode === "login" ? "Log in" : "Create account"}
                    </button>
                    <button
                        type="button"
                        className="link"
                        onClick={() => {
                            setMode(mode === "login" ? "register" : "login");
                            setError(null);
                        }}
                    >
                        {mode === "login"
                            ? "Need an account?"
                            : "Have an account?"}
                    </button>
                </div>
            </form>
            <p className="muted">
                An account let you keep your scores. Alternatively, you can play
                a guest.
            </p>
        </section>
    );
}
