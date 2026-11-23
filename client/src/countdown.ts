import { useEffect, useState } from "react";

/** Whole seconds to show */
export function secondsLeft(ms: number): number {
    return Math.max(0, Math.ceil(ms / 1000));
}

/** Count down from msLeft, sever sends time that is left, not clock time */
export function useCountdown(msLeft: number, resetKey: unknown): number {
    const [left, setLeft] = useState(msLeft);
    useEffect(() => {
        const deadline = Date.now() + msLeft;
        const update = () => setLeft(Math.max(0, deadline - Date.now()));
        update();
        const id = setInterval(update, 250);
        return () => clearInterval(id);
    }, [msLeft, resetKey]);
    return left;
}
