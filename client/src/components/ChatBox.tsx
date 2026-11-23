import { useEffect, useRef, useState, type SubmitEvent } from "react";
import type { ChatEntry } from "../roomState";

/** The chat and the guesses. Text is shown as text, so no one can add HTML */
export function ChatBox({
    messages,
    placeholder,
    onSend,
}: {
    messages: ChatEntry[];
    placeholder: string;
    onSend: (text: string) => void;
}) {
    const [text, setText] = useState("");
    const listRef = useRef<HTMLUListElement>(null);

    useEffect(() => {
        const list = listRef.current;
        if (list) list.scrollTop = list.scrollHeight;
    }, [messages.length]);

    const submit = (e: SubmitEvent<HTMLFormElement>) => {
        e.preventDefault();
        const clean = text.trim();
        if (!clean) return;
        onSend(clean);
        setText("");
    };

    return (
        <div className="chat">
            <ul
                className="chat-list"
                ref={listRef}
                aria-live="polite"
                aria-label="Chat"
            >
                {messages.length === 0 && (
                    <li className="muted">No messages yet.</li>
                )}
                {messages.map((m) =>
                    m.kind === "guessed" ? (
                        <li key={m.key} className="good">
                            <strong>{m.name}</strong> found the word!
                        </li>
                    ) : m.kind === "close" ? (
                        <li key={m.key} className="close">
                            Your guess is close!
                        </li>
                    ) : (
                        <li
                            key={m.key}
                            className={m.knowsWord ? "knows" : undefined}
                        >
                            <strong>{m.name}</strong> {m.text}
                            {m.knowsWord && (
                                <span className="tag">knows the word</span>
                            )}
                        </li>
                    ),
                )}
            </ul>
            <form onSubmit={submit} className="chat-form">
                <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={100}
                    placeholder={placeholder}
                    aria-label="Chat or guess"
                    autoComplete="off"
                />
                <button className="btn primary small">Send</button>
            </form>
        </div>
    );
}
