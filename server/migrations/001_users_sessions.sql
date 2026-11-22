create table users (
  id            integer generated always as identity primary key,
  username      text not null,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

-- Usernames are unique without regard to case: "Sam" and "sam" are the same name
create unique index users_username_lower_idx on users (lower(username));

-- The cookie holds a random token. The table holds only the SHA-256 hash of it,
-- so a leaked database does not give out working sessions
create table sessions (
  token_hash text primary key,
  user_id    integer not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index sessions_user_idx on sessions (user_id);