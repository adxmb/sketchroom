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

## Reference Notes

- Guests have no database rows. A guest name is unique in one room, ignoring letter case. A guest cannot use the name of an account
- A room is removed 10 minutes after creation if nobody joins. A room is removed 60 seconds after its last player leaves
- Rooms live in server memory. A server restart ends all rooms. Many servers would need a shared store such as Redis
- The server checks the Origin header on every WebSocket connection

- A game has rounds. Each player draws once in each round. There are 2 rounds. A turn has 60 seconds of drawing and 5 seconds of reveal
- The server holds all game state. A timer ticks every 500 ms. The server sends msLeft, not a clock time
- Each player gets their own copy of the room state. Only the drawer gets the secret word. After the turn, everyone gets it
- If the drawer leaves, the turn ends at once. If fewer than 2 players are left, the game stops
- A player who joins in the middle of a game can guess but does not draw until the next game
- Words are in the words table in Postgres. The server picks random words at the start of a game
