import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// In development the page runs on port 5173 and the server on port 3000.
// The proxy sends /api and /ws to the server, so the browser sees one address
// and the session cookie works without any extra settings.
export default defineConfig({
    plugins: [react()],
    server: {
        // The client imports ../server/src/protocol.ts
        fs: { allow: [".."] },
        proxy: {
            "/api": "http://localhost:3000",
            "/ws": { target: "ws://localhost:3000", ws: true },
        },
    },
    test: { environment: "node" },
});
