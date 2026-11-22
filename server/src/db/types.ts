export interface Db {
    query<T = Record<string, unknown>>(
        text: string,
        params?: unknown[],
    ): Promise<{ rows: T[] }>;
    exec(sql: string): Promise<void>;
    close(): Promise<void>;
}
