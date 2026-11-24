export interface Config {
    databaseUrl: string;
    port: number;
    host: string;
    allowedOrigins: string[];
    secureCookies: boolean;
    trustProxy: string | false;
    staticDir: string | null;
    debugIp: boolean;
}

function readCount(
    name: string,
    value: string | undefined,
    fallback: number,
    max: number,
): number {
    if (value === undefined || value.trim() === "") return fallback;
    if (!/^\d+$/.test(value.trim()) || Number(value) > max) {
        throw new Error(
            `${name} must be a whole number from 0 to ${max}, but it is "${value}"`,
        );
    }
    return Number(value);
}

export function loadConfig(env: Record<string, string | undefined>): Config {
    const databaseUrl = env.DATABASE_URL?.trim();
    if (!databaseUrl) throw new Error("DATABASE_URL is not set");

    const secure = env.SECURE_COOKIES?.trim().toLowerCase();
    if (
        secure !== undefined &&
        secure !== "" &&
        secure !== "true" &&
        secure !== "false"
    ) {
        throw new Error(
            `SECURE_COOKIES must be "true" or "false", but it is "${env.SECURE_COOKIES}"`,
        );
    }

    return {
        databaseUrl,
        port: readCount("PORT", env.PORT, 3000, 65535),
        host: env.HOST?.trim() || "0.0.0.0",
        allowedOrigins: (env.ALLOWED_ORIGINS ?? "")
            .split(",")
            .map((o) => o.trim())
            .filter(Boolean),
        secureCookies: secure
            ? secure === "true"
            : env.NODE_ENV === "production",
        trustProxy: env.TRUST_PROXY?.trim() || false,
        staticDir: env.STATIC_DIR?.trim() || null,
        debugIp: env.DEBUG_IP?.trim() === "1",
    };
}
