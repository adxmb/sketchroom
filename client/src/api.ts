export interface ApiUser {
    id: number;
    username: string;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function request<T>(
    path: string,
    init?: RequestInit,
): Promise<ApiResult<T>> {
    try {
        const res = await fetch(path, {
            ...init,
            headers: init?.body
                ? { "content-type": "application/json" }
                : undefined,
        });
        if (res.status === 204) return { ok: true, data: undefined as T };
        const body = await res.json().catch(() => ({}));
        if (!res.ok)
            return { ok: false, error: body.error ?? "Something went wrong" };
        return { ok: true, data: body as T };
    } catch {
        return { ok: false, error: "Cannot reach the server" };
    }
}

const post = (body: unknown): RequestInit => ({
    method: "POST",
    body: JSON.stringify(body),
});

export const api = {
    me: () => request<{ user: ApiUser }>("/api/auth/me"),
    register: (username: string, password: string) =>
        request<{ user: ApiUser }>(
            "/api/auth/register",
            post({ username, password }),
        ),
    login: (username: string, password: string) =>
        request<{ user: ApiUser }>(
            "/api/auth/login",
            post({ username, password }),
        ),
    logout: () => request<void>("/api/auth/logout", { method: "POST" }),
    createRoom: (mode: "compete" | "collab") =>
        request<{ code: string }>("/api/rooms", post({ mode })),
};
