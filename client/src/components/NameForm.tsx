import { useState, type SubmitEvent } from "react";
import { usernameSchema } from "../../../server/src/protocol";

export function checkName(name: string): string | null {
    const result = usernameSchema.safeParse(name);
    return result.success
        ? null
        : (result.error.issues[0]?.message ?? "Invalid name");
}

/** Name field for guests */
export function NameForm({
    initial,
    button,
    onSubmit,
    note,
}: {
    initial: string;
    button: string;
    onSubmit: (name: string) => void;
    note?: string;
}) {
    const [name, setName] = useState(initial);
    const [error, setError] = useState<string | null>(null);

    const submit = (e: SubmitEvent<HTMLFormElement>) => {
        e.preventDefault();
        const problem = checkName(name);
        setError(problem);
        if (!problem) onSubmit(name);
    };

    return (
        <form onSubmit={submit} className="stack">
            <label>
                Your name
                <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={20}
                    autoComplete="off"
                />
            </label>
            {note && <p className="muted">{note}</p>}
            {error && (
                <p className="error" role="alert">
                    {error}
                </p>
            )}
            <button className="btn primary">{button}</button>
        </form>
    );
}
