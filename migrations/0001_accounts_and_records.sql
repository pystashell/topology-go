-- Accounts (Better Auth) and game records. See
-- docs/design/accounts-and-game-records.md.
--
-- The first four tables are Better Auth's schema for this configuration
-- (anonymous guests and usernames), as its migration tool generates it for
-- SQLite; keep the names and columns it expects.

CREATE TABLE "user" (
  "id" text not null primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" integer not null,
  "image" text,
  "createdAt" date not null,
  "updatedAt" date not null,
  "isAnonymous" integer,
  "username" text unique,
  "displayUsername" text
);

CREATE TABLE "session" (
  "id" text not null primary key,
  "expiresAt" date not null,
  "token" text not null unique,
  "createdAt" date not null,
  "updatedAt" date not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references "user" ("id") on delete cascade
);

CREATE TABLE "account" (
  "id" text not null primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" date,
  "refreshTokenExpiresAt" date,
  "scope" text,
  "password" text,
  "createdAt" date not null,
  "updatedAt" date not null
);

CREATE TABLE "verification" (
  "id" text not null primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" date not null,
  "createdAt" date not null,
  "updatedAt" date not null
);

CREATE INDEX "session_userId_idx" on "session" ("userId");
CREATE INDEX "account_userId_idx" on "account" ("userId");
CREATE INDEX "verification_identifier_idx" on "verification" ("identifier");

-- One row per finished game. client_key makes saving idempotent: an online
-- round is "room:<code>:<room created at>:<round id>", a game played on one
-- page is "local:<random id the page chose>". data holds the settings and
-- the replay (the format the replay player and SGF export read).
CREATE TABLE game_record (
  id text not null primary key,
  client_key text not null unique,
  source text not null,
  mode text not null,
  game_type text not null,
  width integer not null,
  height integer not null,
  topology text not null,
  black_name text not null,
  white_name text not null,
  black_kind text not null,
  white_kind text not null,
  winner text,
  result text,
  move_count integer not null,
  started_at integer,
  finished_at integer not null,
  room_code text,
  data text not null,
  created_at integer not null
);

-- Who may open a record and finds it under "My games": the two players of
-- an online game, the one person of a game played on one page. Removing a
-- record from one's list deletes only that person's row.
CREATE TABLE game_record_owner (
  record_id text not null references game_record (id) on delete cascade,
  user_id text not null references "user" ("id") on delete cascade,
  color text,
  game_type text not null,
  finished_at integer not null,
  primary key (record_id, user_id)
);

CREATE INDEX game_record_owner_list on game_record_owner (user_id, finished_at desc);
