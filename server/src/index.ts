import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { migrate } from "./db/migrate.js";
import { createPgDb } from "./db/pg.js";
import { RoomManager } from "./game/rooms.js";

let config;
try {
    config = loadConfig(process.env);
} catch (err) {
    console.error((err as Error).message);
    process.exit(1);
}

const db = createPgDb(config.databaseUrl);
const applied = await migrate(db);
if (applied.length) console.log(`applied migrations: ${applied.join(", ")}`);

const rooms = new RoomManager();
const sweeper = setInterval(() => rooms.sweep(), 30_000);
sweeper.unref();

const app = await buildApp({
    db,
    rooms,
    allowedOrigins: config.allowedOrigins,
    secureCookies: config.secureCookies,
    trustProxy: config.trustProxy,
    staticDir: config.staticDir,
    debugIp: config.debugIp,
    logger: true,
});

const shutdown = async () => {
    await app.close();
    await db.close();
    process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port: config.port, host: config.host });
