/** Game rules as pure functions */

/** Each player draws once every round in the same order */
export function buildOrder(playerIds: string[], rounds: number): string[] {
    const order: string[] = [];
    for (let round = 0; round < rounds; round++) order.push(...playerIds);
    return order;
}

/** what the guessers see. _ for each letter with spaces */
export function maskWord(word: string): string {
    return word.replace(/[A-Za-z]/g, "_");
}

/** The index of the next turn whose drawer is still in the room or null if no turns left */
export function nextTurn(
    order: string[],
    current: number,
    present: ReadonlySet<string>,
): number | null {
    for (let i = current + 1; i < order.length; i++) {
        if (present.has(order[i]!)) return i;
    }
    return null;
}

export function normalizeGuess(text: string): string {
    return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isCorrectGuess(guess: string, word: string): boolean {
    return normalizeGuess(guess) === normalizeGuess(word);
}

/** True if `a` and `b` are the same, or differ by one added, removed or changed letter */
function withinOneEdit(a: string, b: string): boolean {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
    const [short, long] = a.length < b.length ? [a, b] : [b, a];
    return short.slice(i) === long.slice(i + 1);
}

/** A wrong guess that is one letter away from the word. Short words are too easy to hit */
export function isCloseGuess(guess: string, word: string): boolean {
    const g = normalizeGuess(guess);
    const w = normalizeGuess(word);
    return w.length >= 4 && g !== w && withinOneEdit(g, w);
}

/** A guesser gets 100 to 500 points. A fast guess gets more */
export function guesserScore(msLeft: number, totalMs: number): number {
    const part = totalMs > 0 ? Math.min(1, Math.max(0, msLeft / totalMs)) : 0;
    return 100 + Math.round(400 * part);
}

/** The drawer gets up to 300 points. The number depends on how many guessers found the word */
export function drawerScore(correct: number, guessers: number): number {
    if (guessers <= 0) return 0;
    return Math.round((300 * Math.min(correct, guessers)) / guessers);
}

/** Sort by score. Players with the same score have the same rank (1, 1, 3) */
export function rankPlayers<T extends { score: number; name: string }>(
    players: T[],
): (T & { rank: number })[] {
    const sorted = [...players].sort(
        (a, b) =>
            b.score - a.score ||
            a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    );
    return sorted.map((p) => ({
        ...p,
        rank: 1 + sorted.filter((o) => o.score > p.score).length,
    }));
}
