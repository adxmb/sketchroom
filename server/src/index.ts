import { buildApp } from "./app.js";
import { migrate } from "./db/migrate.js";
import { createPgDb } from "./db/pg.js";
import { RoomManager } from "./game/rooms.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
}

const db = createPgDb(databaseUrl);
const applied = await migrate(db);
if (applied.length) console.log(`applied migrations: ${applied.join(", ")}`);

const rooms = new RoomManager();
const sweeper = setInterval(() => rooms.sweep(), 30_000);
sweeper.unref();

const app = await buildApp({
    db,
    rooms,
    secureCookies: process.env.NODE_ENV === "production",
    trustProxy: process.env.TRUST_PROXY === "1",
    logger: true,
});

const shutdown = async () => {
    await app.close();
    await db.close();
    process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });
