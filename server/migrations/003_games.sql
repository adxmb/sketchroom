-- One row for each finished game that had at least one account in it
create table games (
  id           integer generated always as identity primary key,
  room_code    text not null,
  rounds       integer not null,
  player_count integer not null,
  played_at    timestamptz not null default now()
);

-- One row for each account that finished a game. Guests are not saved
create table game_players (
  game_id integer not null references games(id) on delete cascade,
  user_id integer not null references users(id) on delete cascade,
  score   integer not null check (score >= 0),
  rank    integer not null check (rank >= 1),
  primary key (game_id, user_id)
);

create index game_players_user_idx on game_players (user_id);