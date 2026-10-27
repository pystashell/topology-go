-- A guest who registers or signs in on its browser joins that account: its
-- records move to the account at once (worker/auth.js adoptGuest) and the
-- guest is deleted. Rooms may still know the person by the guest id (a
-- seat taken as a guest, a game that ends later), so the old id is kept
-- here and resolved to the account when they connect or a game is saved.

CREATE TABLE user_alias (
  old_id text not null primary key,
  new_id text not null references "user" ("id") on delete cascade,
  created_at integer not null
);

CREATE INDEX user_alias_new on user_alias (new_id, created_at desc);
