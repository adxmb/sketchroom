import { useCallback, useEffect, useState } from "react";
import { api, type ApiResult, type ApiUser } from "./api";

/** The loggedin acc, if any */
export function useSession() {
    const [user, setUser] = useState<ApiUser | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let live = true;
        api.me().then((res) => {
            if (!live) return;
            setUser(res.ok ? res.data.user : null);
            setLoading(false);
        });
        return () => {
            live = false;
        };
    }, []);

    const finish = (res: ApiResult<{ user: ApiUser }>) => {
        if (res.ok) setUser(res.data.user);
        return res.ok ? null : res.error;
    };

    return {
        user,
        loading,
        login: useCallback(
            async (u: string, p: string) => finish(await api.login(u, p)),
            [],
        ),
        register: useCallback(
            async (u: string, p: string) => finish(await api.register(u, p)),
            [],
        ),
        logout: useCallback(async () => {
            await api.logout();
            setUser(null);
        }, []),
    };
}

export type Session = ReturnType<typeof useSession>;
