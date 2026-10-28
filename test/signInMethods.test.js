import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { usernameCandidates, usernameFrom } from "../src/multiplayer/accountRules.js";
import { authFor } from "../worker/auth.js";
import { FakeD1 } from "./helpers/d1.js";
import { ORIGIN, PEPPER, browser, environment, upload } from "./helpers/site.js";

/*
 * Account settings beyond email and password: a new username, the ways to
 * sign in (each bound Google account can be unbound, another one bound),
 * the rule that an email belongs to an account only once confirmed, and
 * the username an account made with Google is given.
 */

const accounts = (overrides = {}) => environment({ PASSWORD_PEPPER: PEPPER, ...overrides });
const post = (who, path, body = {}) => who.call(path, { method: "POST", body });
const userId = (env, username) => env.DB.rows("user").find((user) => user.username === username.toLowerCase()).id;

/** An ID token as Google signs it, for the address the page shows. */
function idToken(email) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part({ email, sub: email })}.signature`;
}

function bindGoogle(env, username, email) {
  const id = `google-${email}`;
  env.DB.database.prepare(`INSERT INTO account (id, accountId, providerId, userId, idToken, createdAt, updatedAt)
    VALUES (?, ?, 'google', ?, ?, ?, ?)`).run(id, email, userId(env, username), idToken(email),
    new Date().toISOString(), new Date().toISOString());
  return id;
}

test("the username changes when it is valid and free", async () => {
  const env = accounts();
  const mia = browser(env);
  await post(mia, "/api/account/register", { username: "Mia", password: "mia-password" });
  await post(browser(env), "/api/account/register", { username: "Lee", password: "lee-password" });

  const changed = await post(mia, "/api/account/username", { username: "米娅" });
  assert.equal(changed.status, 200);
  assert.equal(changed.json.account.name, "米娅");
  assert.equal((await mia.call("/api/account")).json.account.name, "米娅");
  assert.equal((await post(browser(env), "/api/account/sign-in", { login: "米娅", password: "mia-password" })).status, 200);
  assert.equal((await post(browser(env), "/api/account/sign-in", { login: "Mia", password: "mia-password" })).status, 401);

  assert.equal((await post(mia, "/api/account/username", { username: "LEE" })).json.code, "USERNAME_TAKEN");
  assert.equal((await post(mia, "/api/account/username", { username: "X" })).json.code, "BAD_USERNAME");
  assert.equal((await post(mia, "/api/account/username", { username: "Guest" })).json.code, "BAD_USERNAME");
  assert.equal((await post(mia, "/api/account/username", { username: "米娅2" })).status, 200);
  assert.equal((await post(browser(env), "/api/account/username", { username: "Nobody" })).json.code, "NOT_SIGNED_IN");
  const guest = browser(env);
  await guest.call("/api/records", { method: "POST", body: upload() });
  assert.equal((await post(guest, "/api/account/username", { username: "Guesty" })).json.code, "NOT_SIGNED_IN");
});

test("the ways to sign in: bound Google accounts, unbound one by one, never the last", async () => {
  const env = accounts();
  const mia = browser(env);
  await post(mia, "/api/account/register", { username: "Mia", password: "mia-password" });
  const first = bindGoogle(env, "Mia", "mia@gmail.com");
  const second = bindGoogle(env, "Mia", "mia.other@gmail.com");
  const me = (await mia.call("/api/account")).json.account;
  assert.deepEqual(me.google, [{ id: first, email: "mia@gmail.com" }, { id: second, email: "mia.other@gmail.com" }]);
  assert.equal(me.hasPassword, true);

  const unbound = await post(mia, "/api/account/google/unlink", { id: second });
  assert.equal(unbound.status, 200);
  assert.deepEqual(unbound.json.account.google, [{ id: first, email: "mia@gmail.com" }]);
  assert.equal((await post(mia, "/api/account/google/unlink", { id: second })).json.code, "GOOGLE_NOT_LINKED");
  assert.equal((await post(mia, "/api/account/google/unlink", { id: "someone-elses" })).json.code, "GOOGLE_NOT_LINKED");

  // Without its password, the last Google account is the only way in.
  env.DB.database.prepare(`DELETE FROM account WHERE providerId = 'credential' AND userId = ?`).run(userId(env, "Mia"));
  const last = await post(mia, "/api/account/google/unlink", { id: first });
  assert.deepEqual([last.status, last.json.code], [409, "LAST_SIGN_IN_METHOD"]);
  assert.equal(env.DB.rows("account").filter(({ providerId }) => providerId === "google").length, 1);
  // A confirmed email signs in too (when codes are on): then it may go.
  env.DB.database.prepare(`UPDATE "user" SET email = 'mia@example.com', "emailVerified" = 1 WHERE username = 'mia'`).run();
  assert.equal((await post(mia, "/api/account/google/unlink", { id: first })).json.code, "LAST_SIGN_IN_METHOD", "codes are off here");
  const withCodes = { ...env, EMAIL_DEV_OUTBOX: "1" };
  const miaWithCodes = browser(withCodes);
  for (const [name, value] of mia.jar) miaWithCodes.jar.set(name, value);
  assert.equal((await post(miaWithCodes, "/api/account/google/unlink", { id: first })).status, 200);
  assert.equal(env.DB.rows("account").length, 0);
});

test("binding a Google account starts at Google and returns to account settings", async () => {
  const env = accounts({ GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "client-secret" });
  const mia = browser(env);
  await post(mia, "/api/account/register", { username: "Mia", password: "mia-password" });
  const started = await post(mia, "/api/account/google/link");
  assert.equal(started.status, 200);
  const url = new URL(started.json.url);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("redirect_uri"), "https://baduk.test/api/auth/callback/google");
  const state = env.DB.rows("verification").map(({ value }) => JSON.parse(value)).at(-1);
  assert.deepEqual([state.callbackURL, state.errorURL], ["/settings?google=linked", "/settings?google=link-failed"]);
  assert.equal(state.link?.userId, userId(env, "Mia"), "the Google account binds to this one");
  assert.equal((await post(browser(env), "/api/account/google/link")).json.code, "NOT_SIGNED_IN");
  const noGoogle = browser(accounts());
  await post(noGoogle, "/api/account/register", { username: "Lee", password: "lee-password" });
  assert.equal((await post(noGoogle, "/api/account/google/link")).json.code, "GOOGLE_UNAVAILABLE");
});

test("only confirmed emails belong to an account", async () => {
  const env = accounts({ EMAIL_DEV_OUTBOX: "1" });
  // Registering takes no email, whatever the page sends.
  const made = await post(browser(env), "/api/account/register", { username: "Mia", password: "mia-password", email: "mia@example.com" });
  assert.equal(made.json.account.email, null);
  assert.match(env.DB.rows("user")[0].email, /@account\.invalid$/u);

  // An email from before, never confirmed: no sign-in with it, no code to it.
  env.DB.database.prepare(`UPDATE "user" SET email = 'mia@example.com', "emailVerified" = 0`).run();
  assert.equal((await post(browser(env), "/api/account/sign-in", { login: "mia@example.com", password: "mia-password" })).json.code, "WRONG_LOGIN");
  const asked = await post(browser(env), "/api/account/email-code", { email: "mia@example.com" });
  assert.deepEqual(asked.json, { ok: true, resendAfter: 60 }, "the same answer as for anyone");
  assert.equal(env.DB.rows("email_send").length, 0, "and no mail");
  // Confirmed, it does both.
  env.DB.database.prepare(`UPDATE "user" SET "emailVerified" = 1`).run();
  assert.equal((await post(browser(env), "/api/account/sign-in", { login: "mia@example.com", password: "mia-password" })).status, 200);

  // Accounts that had unconfirmed emails lose them (migration 0004).
  const db = new FakeD1();
  const insert = db.database.prepare(`INSERT INTO "user" (id, name, email, emailVerified, isAnonymous, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, 0, 0)`);
  insert.run("typed", "Typed", "typed@example.com", 0, 0);
  insert.run("confirmed", "Confirmed", "confirmed@example.com", 1, 0);
  insert.run("guest", "Guest", "temp-1@guest.invalid", 0, 1);
  insert.run("none", "None", "abc@account.invalid", 0, 0);
  db.database.exec(readFileSync(new URL("../migrations/0004_confirmed_emails_only.sql", import.meta.url), "utf8"));
  const emails = Object.fromEntries(db.rows("user").map(({ id, email }) => [id, email]));
  assert.match(emails.typed, /^[0-9a-f]{32}@account\.invalid$/u);
  assert.deepEqual([emails.confirmed, emails.guest, emails.none],
    ["confirmed@example.com", "temp-1@guest.invalid", "abc@account.invalid"]);
});

test("a username made from a Google name: what usernames cannot have dropped, a number when taken", () => {
  assert.deepEqual(usernameCandidates({ name: "Fu Rong", email: "fu@gmail.com" }, 3), ["FuRong", "FuRong2", "FuRong3"]);
  assert.deepEqual([usernameFrom("Jean-Luc Picard"), usernameFrom("付 蓉"), usernameFrom("😀 小明 😀"), usernameFrom("Zoë")],
    ["JeanLucPicard", "付蓉", "小明", "Zoë"]);
  // Nothing usable in the name: the address before the @, else 棋手.
  assert.equal(usernameCandidates({ name: "☆", email: "li.ming@gmail.com" })[0], "liming");
  assert.equal(usernameCandidates({ name: "Guest", email: "a@gmail.com" })[0], "棋手", "reserved, and one letter is too short");
  assert.equal(usernameCandidates({ name: "", email: "lee@account.invalid" })[0], "棋手", "never a made-up address");
  // Cut to fit 20 characters, the number included.
  const long = usernameCandidates({ name: "Christopher Alexander Montgomery" }, 11);
  assert.deepEqual([long[0], long[1], long[10]], ["ChristopherAlexander", "ChristopherAlexande2", "ChristopherAlexand11"]);
  assert.equal(new Set(long).size, 11);
});

test("an account made by signing in with Google gets a username nobody has", async () => {
  const env = accounts();
  await post(browser(env), "/api/account/register", { username: "FuRong", password: "fu-password" });
  const context = await authFor(env, new Request(`${ORIGIN}/`)).$context;
  // As Google sign-in makes an account (the same database hooks).
  const made = (name, email) => context.internalAdapter.createUser({ name, email, emailVerified: true });
  const first = await made("Fu Rong", "fu.rong@gmail.com");
  assert.deepEqual([first.username, first.displayUsername, first.name], ["furong2", "FuRong2", "Fu Rong"]);
  assert.equal((await made("fu rong", "rong.fu@gmail.com")).displayUsername, "furong3");
  assert.equal((await made("☆", "li.ming@gmail.com")).displayUsername, "liming");
  // Stored the way every username is: its key, for looking it up.
  assert.equal(env.DB.rows("user").find(({ email }) => email === "li.ming@gmail.com").username, "liming");

  // Guests and registered accounts are as before.
  const guest = browser(env);
  await guest.call("/api/records", { method: "POST", body: upload() });
  assert.equal(env.DB.rows("user").find((user) => user.isAnonymous === 1).username, null);
  assert.equal((await post(browser(env), "/api/account/register", { username: "Mia", password: "mia-password" })).json.account.name, "Mia");
});

test("an account made with Google before usernames were given gets one on its next visit", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const env = accounts();
  const kai = browser(env);
  await post(kai, "/api/account/register", { username: "Kai", password: "kai-password" });
  await post(browser(env), "/api/account/register", { username: "KaiLin", password: "lin-password" });
  // As Google sign-in made it before: no username, the name from Google.
  env.DB.database.prepare(`UPDATE "user" SET username = NULL, "displayUsername" = NULL, name = 'Kai Lin' WHERE username = 'kai'`).run();
  t.mock.timers.tick(6 * 60 * 1_000);

  assert.equal((await kai.call("/api/account")).json.account.name, "KaiLin2");
  const stored = env.DB.rows("user").find(({ name }) => name === "Kai Lin");
  assert.deepEqual([stored.username, stored.displayUsername], ["kailin2", "KaiLin2"]);
  // Again, while the session's copy still has none: the same name, not another.
  assert.equal((await kai.call("/api/account")).json.account.name, "KaiLin2");
  assert.equal(env.DB.rows("user").filter(({ username }) => username?.startsWith("kailin")).length, 2);
  assert.equal((await post(browser(env), "/api/account/sign-in", { login: "KaiLin2", password: "kai-password" })).status, 200);
});

test("Google sign-in returns to a page that knows whether the account is new", async () => {
  const env = accounts({ GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "client-secret" });
  await post(browser(env), "/api/account/google", { returnTo: "/records" });
  const state = JSON.parse(env.DB.rows("verification").at(-1).value);
  assert.deepEqual([state.callbackURL, state.newUserURL, state.errorURL],
    ["/records?signed-in=google", "/records?signed-in=google-new", "/records?sign-in-failed=google"]);
});
