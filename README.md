# Sketchroom

A real-time multiplayer draw-and-guess game for 2 to 8 players. One player draws a secret word. The others type guesses in the chat. A fast guess scores more points.

![Two players in a game of Sketchroom](docs/img/demo.gif)

**Live site:** https://sketchroom-o978.onrender.com/

> The site runs on a free plan. After 15 minutes without use, it sleeps. The first visit then takes about a minute. Rooms are kept in memory, so a sleep or a restart ends all rooms.

## Features

- Rooms with a 5-character code and a link. Up to 8 players in a room.
- Play as a guest, or register an account.
- Live drawing: 7 colours (the last one is white and works as an eraser), 3 brush sizes, undo, and clear.
- Guessing in the chat. A guess that is one letter away gets a private "close" notice.
- Scores for guessers and for the drawer. A results screen at the end of the game.
- Saved scores for accounts: a top-10 leaderboard and personal stats.
- A player who reloads the page, or loses the connection, gets the same seat back (30 seconds).
- Server-side game rules. The client cannot get the secret word.

## How to play

1. Create a room and share the link or the 5-character code.
2. The host starts the game when at least 2 players are in the room.
3. A game has 2 rounds. In each round, every player draws once.
4. The drawer sees a secret word and has 60 seconds to draw it. The others see one underscore for each letter.
5. Guessers type their guesses in the chat. After each turn, everyone sees the word for 5 seconds.
6. The player with the most points wins.

| Who     | Points                                                    |
| ------- | --------------------------------------------------------- |
| Guesser | `100 + round(400 × timeLeft / 60 s)`, so 100 to 500       |
| Drawer  | `round(300 × guessersWhoFoundIt / guessers)`, so 0 to 300 |

A turn ends at once when every guesser found the word.

## Screenshots

| Lobby                              | Drawing                               |
| ---------------------------------- | ------------------------------------- |
| ![Lobby](docs/img/lobby.png)       | ![Drawing](docs/img/drawing.png)      |
| **Guessing**                       | **Final scores**                      |
| ![Guessing](docs/img/guessing.png) | ![Final scores](docs/img/results.png) |

## Tech stack

| Part      | What                                                               |
| --------- | ------------------------------------------------------------------ |
| Language  | TypeScript, in the server and in the client                        |
| Server    | Node 22, Fastify 5, `@fastify/websocket`, zod 4 for message checks |
| Database  | Postgres 16 (`pg`), plain SQL migrations                           |
| Passwords | Argon2 (`@node-rs/argon2`)                                         |
| Client    | React 19, Vite 8, react-router 7. No UI or drawing library.        |
| Tests     | vitest 5, PGlite (Postgres in memory), real WebSocket clients      |
| CI        | GitHub Actions: type checks, tests, builds, and a Docker build     |
| Deploy    | One Docker image on Render (free plan). Neon Postgres (free plan). |

## How it works

```
Browser (React)  ──HTTP──▶  Fastify  ──SQL──▶  Postgres
       │                      ▲
       └──────WebSocket───────┘
                  │
            RoomManager (rooms, games, scores in memory)
```

- The server is the only authority. The client sends actions (a stroke, a guess). The server decides what happens and sends each player their own view of the room.
- Game rules are pure functions (`rules.ts`, `canvas.ts`). They have no timers and no network code, so tests are fast.
- Time is passed into the room manager. Tests move a fake clock.
- The server sends `msLeft`, not clock times, so a wrong clock on a device does not matter.
- The client and the server share one file, `protocol.ts`. It holds every message type and its zod check.

More detail: [docs/design.md](docs/design.md).

## Run it on your computer

You need Node 22 and Docker.

```bash
# 1. The database (Postgres 16 on port 5433)
docker compose up -d db

# 2. The server (http://localhost:3000)
cd server
npm ci
export DATABASE_URL="postgres://sketch:sketch@localhost:5433/sketchroom"
npm run dev

# 3. The client (http://localhost:5173), in a second terminal
cd client
npm ci
npm run dev
```

Open http://localhost:5173. Open a second window (a private window works as a second player) and join the same room.

The server runs the database migrations at the start. They make the tables and add 106 words.

### Test the production image

```bash
docker compose --profile prod up --build
```

Open http://localhost:3000. The server then serves the built client, as it does on the live site.

## Tests

```bash
cd server && npm run typecheck && npm test
cd client && npm run typecheck && npm test
```

There are about 250 automated tests (216 in the server, 32 in the client). The server tests need no Docker. They use PGlite, a Postgres that runs in memory. The tests cover game rules, the room manager, the REST routes, and full games over real WebSocket connections.

Automated tests do not cover touch drawing.

## Deploy

The repo has a `Dockerfile` and a `render.yaml` for [Render](https://render.com). The database is on [Neon](https://neon.com).

1. Make a Neon project. Copy its connection string.
2. In Render, make a **Blueprint** from this repo. Paste the connection string as `DATABASE_URL`.
3. Set `TRUST_PROXY` (see [docs/design.md](docs/design.md#deployment)).

### Settings

| Variable          | Needed | Meaning                                                                                                 |
| ----------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`    | yes    | Postgres connection string                                                                              |
| `PORT`            | no     | Port of the server. Default 3000.                                                                       |
| `HOST`            | no     | Address to listen on. Default `0.0.0.0`.                                                                |
| `STATIC_DIR`      | no     | Folder with the built client. The Docker image sets it.                                                 |
| `NODE_ENV`        | no     | `production` turns on secure cookies (HTTPS only).                                                      |
| `SECURE_COOKIES`  | no     | `true` or `false`. Overrides the `NODE_ENV` default.                                                    |
| `TRUST_PROXY`     | no     | Proxies to trust for `X-Forwarded-For`: IP ranges, or the names `loopback`, `linklocal`, `uniquelocal`. |
| `ALLOWED_ORIGINS` | no     | Extra origins for the WebSocket, separated by commas.                                                   |
| `DEBUG_IP`        | no     | `1` adds `GET /debug/ip`. Use it once to set `TRUST_PROXY`. Then remove it.                             |

The server stops at the start, with a clear message, if a setting is wrong.

## Project layout

```
client/            React app (Vite)
  src/roomState.ts   one reducer for every server event
  src/useRoom.ts     the WebSocket hook, with automatic reconnect
  src/components/    DrawingBoard, GameScreen, ChatBox, ...
server/
  src/protocol.ts    all message types and checks (shared with the client)
  src/game/          rooms, rules, gateway (WebSocket)
  src/canvas.ts      drawing rules and limits
  src/auth/          accounts, sessions, passwords
  src/stats.ts       saved games, leaderboard
  migrations/        SQL files, applied in order at the start
docs/design.md     design notes and decisions
Dockerfile         one image for the server and the client
render.yaml        Render service
```

## Known limits

- Rooms live in memory. A restart or a sleep of the server ends all rooms.
- A page reload clears the chat in that page. The server does not keep chat history.
- A player who leaves in the middle of a game loses the score. A game that stops early (fewer than 2 players) is not saved.
- Only accounts have saved scores. Guests do not.
- A player who joins during a game can guess, but does not get a turn.
- The free plan sleeps after 15 minutes. The first visit then takes about a minute.

## Roadmap

- **Mode C: a shared whiteboard.** Everyone draws together. The room already has a `collab` mode in its message checks. The screens and the rules are not built yet.
