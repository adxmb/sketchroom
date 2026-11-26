# Sketchroom: design notes

These notes explain how Sketchroom works and why it is built this way. The README has the short version.

## Contents

1. [Goals](#goals)
2. [Architecture](#architecture)
3. [Messages](#messages)
4. [Rooms and the game](#rooms-and-the-game)
5. [Drawing](#drawing)
6. [Guessing, chat and scores](#guessing-chat-and-scores)
7. [Reconnecting](#reconnecting)
8. [Database](#database)
9. [Accounts and sessions](#accounts-and-sessions)
10. [Security](#security)
11. [Limits](#limits)
12. [Deployment](#deployment)
13. [Testing](#testing)
14. [Decisions and trade-offs](#decisions-and-trade-offs)
15. [Known limits](#known-limits)
16. [Mode C](#mode-c)

## Goals

- A real-time multiplayer game that works in the browser with no install.
- The server decides everything. A player cannot cheat by changing the client.
- Code that is easy to test: pure rules, a fake clock, and real WebSocket tests.
- A project that anyone can run with two commands, and deploy as one Docker image.

## Architecture

```
Browser (React)  ──HTTP──▶  Fastify  ──SQL──▶  Postgres
       │                      ▲
       └──────WebSocket───────┘
                  │
            RoomManager (in memory)
```

- **HTTP** handles accounts, room creation, the leaderboard, and the files of the client.
- **WebSocket** (`/ws`) handles everything inside a room: joining, drawing, chat, and game state.
- **RoomManager** holds all live rooms, games, scores, and strokes in memory. It has no network code. The gateway calls it and sends the results.
- **Postgres** holds accounts, sessions, words, and finished games. Nothing about a live game is in the database.

### Shared code

`server/src/protocol.ts` has every message type, its zod check, and the rules for names and room codes. The client imports it. This gives one source of truth, and a type error if the two sides disagree. The file may import only `zod`. `canvas.ts` is shared the same way, so the drawer's screen and the server apply a stroke with the same code.

### One reducer in the client

`roomReducer` in `client/src/roomState.ts` handles every event: server messages, local drawing, and connection changes. It is a plain function, so tests call it with no browser.

## Messages

All WebSocket messages are JSON. The server checks each one with zod before it uses it. A message that fails the check gets `bad_message`.

**Client to server**

| Message                       | Use                                                   |
| ----------------------------- | ----------------------------------------------------- |
| `join_room`                   | Join a room with a code. A guest also sends a name.   |
| `leave_room`                  | Leave on purpose. The seat is not kept.               |
| `start_game`                  | The host starts the game.                             |
| `draw`                        | A chunk of a stroke (at most 50 points). Drawer only. |
| `undo_stroke`, `clear_canvas` | Drawer only.                                          |
| `chat`                        | A chat message, or a guess. 1 to 100 characters.      |

**Server to client**

| Message          | Use                                                                       |
| ---------------- | ------------------------------------------------------------------------- |
| `welcome`        | The id of the player. Sent once after a join.                             |
| `room_state`     | The whole room, as this player may see it.                                |
| `draw`, `canvas` | A new chunk, or the whole drawing (after undo, clear, or a late join).    |
| `chat`           | A chat line, a "found the word" line, or a private "close" notice.        |
| `left`           | The player left on purpose.                                               |
| `error`          | A code and a text. For example `room_full`, `name_taken`, `rate_limited`. |

**REST**

| Route                                          | Use                                         |
| ---------------------------------------------- | ------------------------------------------- |
| `POST /api/rooms`                              | Make a room.                                |
| `POST /api/guest`                              | Give the browser a guest cookie.            |
| `POST /api/auth/register`, `/login`, `/logout` | Accounts.                                   |
| `GET /api/auth/me`                             | The logged-in account, or 401.              |
| `GET /api/leaderboard`                         | The top 10 accounts.                        |
| `GET /api/stats`                               | Stats of the logged-in account.             |
| `GET /health`                                  | Health check. It does not use the database. |

The server handles the messages of one connection one at a time, in order. A fast sequence such as "join", then "chat", is never mixed up.

## Rooms and the game

A room has a code, a mode, players, a host, and maybe a game.

```
lobby ──start_game (host, 2+ players)──▶ drawing ──time ends or all guessed──▶ reveal
  ▲                                         ▲                                     │
  │                                         └───── next turn (reveal ends) ◀──────┘
  └────────────── last turn ends: results are kept for the end screen ◀──────────┘
```

- A game has 2 rounds. In each round, every player who was in the room at the start draws once. A player who joins later can guess but gets no turn.
- A turn has two phases: `drawing` (60 s) and `reveal` (5 s).
- A ticker runs every 500 ms. It moves the game forward when a timer ends and sends a new state to the rooms that changed.
- At the start, the server picks random words from the database, one for each turn.
- The secret word is hidden by one function, `gameView()`. It decides who sees the word: the drawer, and everyone during the reveal. No other code path puts the word in a message.
- The server sends `msLeft`, not a clock time. The clock of a device does not matter.
- When the host leaves, the next player in the room becomes the host.
- When a drawer leaves during a turn, the turn ends at once, with no points for the drawer. When fewer than 2 players are left, the game stops and does not count.

Room cleanup: a room that no one ever joined is removed after 10 minutes. A room that became empty is removed after 60 seconds. There is a limit of 200 rooms.

## Drawing

- The board is 800 by 600 units on every screen. The client scales it. All points use board units.
- A colour and a brush size are sent as indexes into a fixed list (7 colours, 3 sizes). The last colour is white and works as an eraser.
- The drawer sends a chunk of at most 50 points every 50 ms. The server checks it, keeps it, and sends it to the others. The drawer does not get an echo. The drawer's screen already shows the stroke.
- Undo and clear send the whole drawing to the others, because it is simple and the drawing is small.
- A player who joins late gets the whole drawing.
- Limits for each turn: 300 strokes, 2000 points in one stroke, and 10,000 points in total. A chunk that breaks a limit is refused with `canvas_limit`.
- The strokes stay during the reveal. They are cleared when the next turn starts.

## Guessing, chat and scores

- During `drawing`, a chat message from a guesser who has not found the word is a **guess**.
- A correct guess is never sent as text. Everyone gets a "found the word" line. This keeps the word secret.
- A guess that is one letter away (and the word has 4 or more letters) gets a private "close" notice.
- The drawer and the players who found the word chat only with each other. Their lines are marked "knows the word". The others never get them, because a hint could give the word away.
- Outside a turn (in the lobby, or during the reveal), chat goes to everyone.
- Chat is shown as text. React does not put chat text into the page as HTML.

| Who     | Points                                                         |
| ------- | -------------------------------------------------------------- |
| Guesser | `100 + round(400 × msLeft / drawMs)`                           |
| Drawer  | `round(300 × correct / guessers)`, paid at the end of the turn |

- The drawer gets no points if the drawer leaves during the turn.
- A turn ends at once when all connected guessers found the word.
- The final ranking is a competition ranking: 1, 1, 3 for equal scores. Players with equal scores sort by name.

## Reconnecting

Problem: a page reload or a short loss of the network must not throw a player out of a game.

- A guest gets a random cookie, `gid`. The page calls `POST /api/guest` before the first WebSocket connection. The cookie is `httpOnly`, so page code cannot read it.
- The identity of a player in a room is the **owner** and the **name** together. The owner is `u:<account id>` for an account, or `g:<cookie>` for a guest.
- When a connection closes, a player who has an owner stays in the room for 30 seconds, marked offline. Others see an "Offline" badge.
- A player who joins again with the same owner and name gets the same seat: the same id, score, host role, and game state.
- If the player does not return, the player leaves after 30 seconds, with the normal rules for a leaving player.
- A guest with no cookie has no owner. That player leaves at once.
- Another browser that uses the same name gets `name_taken`. Two tabs of one browser can play with different names.
- A new connection of the same player replaces the old one. The old one is closed with code 4000. It cannot change the seat afterwards, because it checks that it still owns the seat.
- The server does not wait for guessers who are offline when it decides if all guessers found the word.
- The client retries 5 times, after 0.5, 1, 2, 4, and 8 seconds. During this time, the screen stays and shows a banner. It does not retry after the server closes with 1008 (too many messages) or 4000 (replaced).
- The server pings every connection every 20 seconds. A connection that does not answer is closed. A lost network does not send a close message, so without the ping, a dead connection would look alive for a long time.

## Database

Tables: `users`, `sessions`, `words`, `games`, `game_players`, and `schema_migrations`.

- **Migrations** are plain SQL files, applied in order at the start. Each one runs once and never changes after that. New words after a deploy need a new migration with `on conflict (text) do nothing`.
- **Words:** 106 words, loaded by migration 002. The server picks random words with `order by random()`.
- **Saving games:** a finished game is saved with one SQL statement (a CTE with `unnest`), so it is all or nothing. Only accounts are saved. A game with only guests saves nothing.
- **Leaderboard:** the top 10 accounts by total score. Ties go to the account with fewer games, then by name.
- **Stats:** games played, wins, best score, and total score for one account. A win is rank 1, so a tie for first place counts as a win for each of those players.
- Games and scores of an account are deleted when the account is deleted (`on delete cascade`).
- The connection pool has an `error` handler. A host such as Neon puts an idle database to sleep and closes the connections. Without a handler, that error would stop the whole server.

## Accounts and sessions

- Usernames: 3 to 20 characters, letters, numbers, and underscores. Names are unique without regard to case. A guest cannot use a name that belongs to an account.
- Passwords are hashed with Argon2. When a username does not exist, the server still checks a dummy hash, so a failed login takes about the same time either way.
- A session is a random token in an `httpOnly`, `SameSite=Lax` cookie (`sid`), valid for 14 days. The database stores only the SHA-256 hash of the token. A leaked database does not give out working sessions.
- In production the cookies are `Secure` (HTTPS only).

## Security

- Every WebSocket message and every request body is checked with zod.
- The WebSocket checks the `Origin` header. Another website cannot use a visitor's cookie to open a connection.
- Rate limits on every route that can be abused. See [Limits](#limits).
- Size limits: 4096 bytes for a WebSocket message, 16 KB for an HTTP body.
- The secret word has one exit, `gameView()`. See [Rooms and the game](#rooms-and-the-game).
- Strict headers on every answer: a Content-Security-Policy (`default-src 'self'`, no outside scripts, `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy: no-referrer`.
- The client has no outside scripts, fonts, or images. This is why the policy can be strict.
- The Docker image does not run as root. Only production packages are in the image.
- `TRUST_PROXY` is a list of addresses. See [Deployment](#deployment).
- Chat text is shown as text. A test checks that HTML in chat stays as text.

## Limits

| What                              | Limit                                                      |
| --------------------------------- | ---------------------------------------------------------- |
| WebSocket message size            | 4096 bytes                                                 |
| Messages for each connection      | 60 each second (more closes the connection, code 1008)     |
| Chat messages for each connection | 5 in 5 seconds (`rate_limited`, the connection stays open) |
| Failed joins for each connection  | 10 (then the connection closes, code 1008)                 |
| Open connections for each IP      | 20 (more get HTTP 429)                                     |
| Rooms made for each IP            | 20 each minute                                             |
| Register and login for each IP    | 10 each minute                                             |
| Guest cookie route                | 30 each minute                                             |
| Leaderboard and stats             | 60 each minute                                             |
| HTTP body                         | 16 KB                                                      |
| Rooms in the server               | 200                                                        |
| Players in a room                 | 8                                                          |
| Strokes in a turn                 | 300 (2000 points in one stroke, 10,000 in total)           |
| Chat text                         | 100 characters                                             |
| Time to come back                 | 30 seconds                                                 |
| Session                           | 14 days                                                    |
| Guest cookie                      | 1 day                                                      |

## Deployment

### One image

The server serves the built client. One address serves the pages, the API, and the WebSocket. This means:

- no CORS settings,
- cookies work with no extra setup,
- the WebSocket uses the same host as the page.

The `Dockerfile` has three stages: build (client and server), production packages only, and the final image. The client imports `server/src/protocol.ts`, so the build context is the repo root.

A page address such as `/r/ABCDE` has no file. The server returns the app for any `GET` address that is not `/api/...`, `/ws`, or a file name. The app then shows the right page. A missing file or API address is a real 404.

Files in `assets/` have a hash in the name, so a browser keeps them for a year. `index.html` is never kept (`no-cache`), so a new deploy shows at once.

### Hosts

- **Render** (free plan) runs the Docker image. It sleeps after 15 minutes without HTTP requests or WebSocket messages. A visit then takes about a minute. 750 free instance hours each month.
- **Neon** (free plan) holds the database. It does not expire. It pauses when idle, so the first query after a pause is slower.
- Render's own free Postgres expires 30 days after it is made. This is why the database is on Neon.
- The Render region is Singapore. The Neon region is Sydney. These are the closest regions to New Zealand.
- `GET /health` does not use the database. A health check does not wake a database that sleeps.

### Finding the visitor's address

Limits count requests for each IP. Behind a proxy, the server must read the visitor's address from `X-Forwarded-For`. A client can write that header itself, so the server must believe only the parts that trusted proxies added.

The server starts at the right end of the header. It skips every address that is trusted. The first address that is not trusted is the visitor. Anything further to the left is not believed.

`TRUST_PROXY` is the list of trusted addresses. It is never `true` and never a number of proxies. Fastify 5 does not allow a number, because a direct client could fake it.

On Render, a request comes through three layers: a local proxy (`127.0.0.1`), Render's private network (`10.x.x.x`), and Cloudflare (public addresses). So the value is:

```
loopback,uniquelocal,<Cloudflare's IP ranges>
```

`GET /debug/ip` shows what the server sees: the `ip` it uses and the `X-Forwarded-For` header. It exists only when `DEBUG_IP=1`. Use it once, check that `ip` equals your own public address, then remove `DEBUG_IP`.

Cloudflare's published list is at https://www.cloudflare.com/ips/. It changes rarely. If it changes, some visitors look like one Cloudflare address and share one limit. Check the list once or twice a year. Last checked: YYYY-MM-DD.

If the setting is wrong, all visitors look like one address. They then share one limit of 20 connections, and new players get `429 Too many connections`.

### Settings

The server reads all settings in one place, `config.ts`. It stops at the start, with a clear message, if one is wrong. This is better than a failure in the middle of a game.

## Testing

| Layer                           | How                                                             |
| ------------------------------- | --------------------------------------------------------------- |
| Rules (`rules.ts`, `canvas.ts`) | Pure functions. Plain unit tests.                               |
| Room manager                    | A fake clock and fake room codes. No network.                   |
| REST routes                     | Fastify `inject`. No port.                                      |
| Database                        | PGlite (Postgres in memory). The same SQL as production.        |
| Whole server                    | A real server, real `ws` clients. Full games with short timers. |
| Client                          | The reducer is tested as a plain function.                      |
| Static files and config         | Tests with a temporary folder, and with `inject`.               |

- The server tests need no Docker.
- CI runs the type checks, the tests, the builds, and a Docker build.
- Tests that wait for a closed connection poll until the server sees it. They do not use a fixed sleep.
- Not covered by automated tests: touch drawing, and a real Render or Neon deploy.

## Decisions and trade-offs

| Decision                                   | Why                                                        | Cost                                             |
| ------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------ |
| Rooms in memory                            | Simple. Fast. A game has a short life.                     | A restart ends all rooms. One server only.       |
| The server sends a whole view, not a patch | Simple. The client has one reducer.                        | More data for each change. Fine for 8 players.   |
| One shared `protocol.ts`                   | One truth for both sides. A type error shows a mismatch.   | The client build needs the server folder.        |
| Undo and clear send the whole drawing      | Simple. Drawings are small.                                | More data than a patch.                          |
| Guest seat = cookie + name                 | Two tabs of one browser can play. A reload keeps the seat. | A guest who clears cookies cannot return.        |
| 30 seconds to come back                    | Long enough for a reload or a short network loss.          | A drawer who is offline wastes up to 30 seconds. |
| One Docker image                           | One address. No CORS.                                      | The client and the server deploy together.       |
| `TRUST_PROXY` as a list                    | A direct client cannot fake its address.                   | Needs a one-time measurement on a new host.      |
| Neon, not Render Postgres                  | Render's free database expires after 30 days.              | A second service to manage.                      |
| Time passed into the room manager          | Tests move a fake clock.                                   | One more option to pass.                         |

## Known limits

- Rooms live in memory. A restart or a sleep ends all rooms.
- A page reload clears the chat in that page. The server keeps no chat history. A player who joins late sees only new messages.
- A player who leaves in the middle of a game loses the score and is not in the final scores.
- A game that stops early is not saved. A game is saved when the last reveal ends.
- Guests have no saved scores.
- The free plan sleeps after 15 minutes.
- A message sent to the drawer's private chat while a player is offline is lost for that player.
- One server only. Two servers would not share rooms.

## Mode C

Mode C is a shared whiteboard: everyone draws together, with no secret word and no turns. The room already has a `collab` value in its mode check. The rules and screens are not built yet.

Open questions:

- Strokes now belong to one drawer. In a shared board, every stroke needs an owner and an id, so each player can undo only their own strokes.
- Several players draw at the same time. The server must give one order to all strokes.
- The limits (strokes, points) must change from "for each turn" to "for each board".
- The board has no timer, so the board must be saved or cleared by a rule.
