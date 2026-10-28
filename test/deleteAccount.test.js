import assert from "node:assert/strict";
import test from "node:test";

import { saveRecord } from "../worker/records.js";
import { PEPPER, browser, environment, upload } from "./helpers/site.js";

/*
 * Deleting one's own account (account settings): the username typed to
 * confirm, and, unless just signed in, the current password or a new
 * sign-in. The account's sign-ins, sessions and games go; the other player
 * of a game keeps theirs.
 */

const accounts = () => environment({ PASSWORD_PEPPER: PEPPER });
const post = (who, path, body = {}) => who.call(path, { method: "POST", body });
const userId = (env, username) => env.DB.rows("user").find((user) => user.username === username.toLowerCase())?.id;

/** A game Mia and Lee played online, as their room saves it. */
function playedTogether(env, key) {
  return saveRecord(env.DB, {
    client_key: key, source: "online", mode: "friend", game_type: "go", width: 9, height: 9,
    topology: "torus", black_name: "Mia", white_name: "Lee", black_kind: "human", white_kind: "human",
    winner: "black", result: "B+R", move_count: 3, started_at: 1, finished_at: Date.now(), room_code: "AB23CD",
    data: "{}",
  }, [{ userId: userId(env, "Mia"), color: "black" }, { userId: userId(env, "Lee"), color: "white" }]);
}

test("an account is deleted with its sign-ins and games; the other player keeps theirs", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const env = accounts();
  // Mia played as a guest first, then registered (her guest id is remembered).
  const mia = browser(env);
  await mia.call("/api/records", { method: "POST", body: upload() });
  await post(mia, "/api/account/register", { username: "Mia", password: "mia-password" });
  const tablet = browser(env);
  await post(tablet, "/api/account/sign-in", { login: "Mia", password: "mia-password" });
  const lee = browser(env);
  await post(lee, "/api/account/register", { username: "Lee", password: "lee-password" });
  const shared = await playedTogether(env, "room:AB23CD:1:1");
  const miaId = userId(env, "Mia");
  assert.equal(env.DB.rows("user_alias").length, 1);
  assert.equal((await mia.call("/api/records")).json.records.length, 2);

  for (const username of ["", "Lee", "Mi", undefined]) {
    const refused = await post(mia, "/api/account/delete", { username });
    assert.deepEqual([refused.status, refused.json.code], [400, "USERNAME_MISMATCH"], String(username));
  }
  assert.ok(userId(env, "Mia"), "nothing deleted yet");

  const deleted = await post(mia, "/api/account/delete", { username: " mia " });
  assert.deepEqual([deleted.status, deleted.json], [200, { ok: true }]);
  assert.equal(userId(env, "Mia"), undefined);
  for (const table of ["session", "account"]) {
    assert.equal(env.DB.rows(table).filter((row) => row.userId === miaId).length, 0, table);
  }
  assert.equal(env.DB.rows("user_alias").length, 0);
  assert.equal(env.DB.rows("game_record_owner").filter(({ user_id }) => user_id === miaId).length, 0);
  // Her own game is gone; the one with Lee stays his.
  assert.deepEqual(env.DB.rows("game_record").map(({ id }) => id), [shared]);
  assert.deepEqual((await lee.call("/api/records")).json.records.map(({ id }) => id), [shared]);

  // This browser is signed out; the tablet within the session cache's minutes.
  assert.equal((await mia.call("/api/account")).json.account, null);
  t.mock.timers.tick(6 * 60 * 1_000);
  assert.equal((await tablet.call("/api/account")).json.account, null);
  assert.equal((await post(browser(env), "/api/account/sign-in", { login: "Mia", password: "mia-password" })).json.code, "WRONG_LOGIN");
  // The username is free again.
  assert.equal((await post(browser(env), "/api/account/register", { username: "Mia", password: "new-mia-password" })).status, 201);
});

test("an account made with Google confirms with the name Google gave it", async () => {
  const env = accounts();
  const kai = browser(env);
  await post(kai, "/api/account/register", { username: "Kai", password: "kai-password" });
  // As Google sign-in makes it: no username, the name from Google.
  env.DB.database.prepare(`UPDATE "user" SET username = NULL, "displayUsername" = NULL, name = 'Kai Lin'`).run();
  assert.equal((await post(kai, "/api/account/delete", { username: "Kai" })).json.code, "USERNAME_MISMATCH");
  assert.equal((await post(kai, "/api/account/delete", { username: " kai lin " })).status, 200);
  assert.equal(env.DB.rows("user").length, 0);
});

test("later, deleting needs the current password, or a new sign-in without one", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const env = accounts();
  const mia = browser(env);
  await post(mia, "/api/account/register", { username: "Mia", password: "mia-password" });
  const lee = browser(env);
  await post(lee, "/api/account/register", { username: "Lee", password: "lee-password" });
  t.mock.timers.tick(11 * 60 * 1_000);

  const missing = await post(mia, "/api/account/delete", { username: "Mia" });
  assert.deepEqual([missing.status, missing.json.code], [400, "NEED_CURRENT_PASSWORD"]);
  const wrong = await post(mia, "/api/account/delete", { username: "Mia", currentPassword: "nope-nope" });
  assert.deepEqual([wrong.status, wrong.json.code], [401, "WRONG_PASSWORD"]);
  assert.equal((await post(mia, "/api/account/delete", { username: "Mia", currentPassword: "mia-password" })).status, 200);
  assert.equal(userId(env, "Mia"), undefined);

  // Without a password (Google or email codes only), sign in again first.
  env.DB.database.prepare(`DELETE FROM account WHERE providerId = 'credential' AND userId = ?`).run(userId(env, "Lee"));
  const again = await post(lee, "/api/account/delete", { username: "Lee", currentPassword: "lee-password" });
  assert.deepEqual([again.status, again.json.code], [403, "SIGN_IN_AGAIN"]);
  assert.ok(userId(env, "Lee"));

  // Guests and nobody cannot.
  assert.equal((await post(browser(env), "/api/account/delete", { username: "Lee" })).json.code, "NOT_SIGNED_IN");
  const guest = browser(env);
  await guest.call("/api/records", { method: "POST", body: upload() });
  assert.equal((await post(guest, "/api/account/delete", { username: "Guest" })).json.code, "NOT_SIGNED_IN");
  assert.equal(env.DB.rows("user").filter((user) => user.isAnonymous === 1).length, 1, "the guest stays");
});
