# Design notes

## Goal

A multiplayer drawing game that runs in the browser. Mode A: players take turns to
draw a secret word, and the others guess it. Mode C (later): players draw together on
one shared board.

## Where data lives

| Data                                       | Place         | Reason                            |
| ------------------------------------------ | ------------- | --------------------------------- |
| Users, sessions, scores, words             | Postgres      | It must survive a restart         |
| Live rooms (players, turn, timer, strokes) | Server memory | It changes many times each second |

Known limit: a restart of the server ends all running rooms. To run more than one
server, the rooms must move to a shared store such as Redis.

## Rules

- The server decides everything. The client only sends actions.
- The server never sends the secret word to a guesser.
- Every message from a client is checked for its type, its size and its rate.
- Chat text is escaped before it is shown.
- A WebSocket connection is accepted only if its Origin header is the site's own address.
- Game rules are plain functions with no network code, so unit tests can run them.

## Accounts

- Username and password. The password is hashed with argon2id.
- A session is a random token in an HttpOnly, SameSite=Lax cookie. The database
  stores only the SHA-256 hash of the token.
- Guests can join a room without an account. Only accounts keep scores.
- Login and register are rate limited for each IP address.

## Tables

Day 1 (done): `users`, `sessions`.

Later:

- `games` (id, room_code, mode, started_at, ended_at)
- `game_players` (game_id, user_id, score, placement)
- `words` (id, text, category)

`mode` is `compete` or `collab`, so mode C can use the same tables.

## Messages (draft)

Client to server: `join_room`, `leave_room`, `start_game`, `stroke`, `clear_canvas`,
`guess`, `chat`.

Server to client: `room_state`, `player_joined`, `player_left`, `round_start`
(the drawer gets the word, the others get its length), `stroke`, `guess_result`,
`round_end`, `game_end`, `error`.

## Plan

1. Day 1: repository, CI, database tables, register and login. (done)
2. Day 2: React client, WebSocket connection, rooms, join code, lobby.
3. Day 3: game loop on the server: turn order, secret word, timer, round end.
4. Day 4: drawing. The drawer sends strokes. The server sends them to the others.
5. Day 5: guessing, chat, scoring, end-of-game screen. Save scores for accounts.
6. Day 6: reconnect after a lost connection, limits, more tests.
7. Day 7: deploy, README, screenshots, a short demo clip.
