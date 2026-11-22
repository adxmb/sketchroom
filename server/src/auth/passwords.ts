import { hash, verify } from "@node-rs/argon2";

export const hashPassword = (passowrd: string) => hash(passowrd);

export async function verifyPassword(
    storedHash: string,
    password: string,
): Promise<boolean> {
    try {
        return await verify(storedHash, password);
    } catch {
        return false;
    }
}

// Used when a username does not exist, so a failed login takes similar time whether name exists or not
let dummy: Promise<string> | undefined;
export async function burnTime(password: string): Promise<void> {
    dummy ??= hash("not-a-real-password");
    await verifyPassword(await dummy, password);
}
