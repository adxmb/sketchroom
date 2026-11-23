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
