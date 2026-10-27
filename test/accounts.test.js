import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanEmail,
  cleanUsername,
  isMadeUpEmail,
  passwordAllowed,
  usernameKey,
} from "../src/multiplayer/accountRules.js";
import { SESSION_FORMER_USERS_HEADER, SESSION_USER_HEADER } from "../worker/BadukRoom.js";
import { adoptGuest, formerUserIds, googleConfigured, passwordsConfigured } from "../worker/auth.js";
import { saveRecord } from "../worker/records.js";
import { PASSWORD_ITERATIONS, hashPassword, verifyPassword } from "../worker/passwords.js";
import { PEPPER, browser, createBody, environment, joinBody, upload } from "./helpers/site.js";

/*
 * Accounts (phase 2 of docs/design/accounts-and-game-records.md): register
 * with a username and password (email optional), sign in with either, sign
 * out; a guest that registers or signs in brings its games and its seats
 * along. Google sign-in is off until its secrets are set.
 */

const accounts = (overrides = {}) => environment({ PASSWORD_PEPPER: PEPPER, ...overrides });
const register = (who, body) => who.call("/api/account/register", { method: "POST", body });
const signIn = (who, login, password) => who.call("/api/account/sign-in", { method: "POST", body: { login, password } });

test("usernames, emails and passwords follow the owner's rules", () => {
  assert.equal(cleanUsername("  棋手Mia_2 "), "棋手Mia_2");
  assert.equal(cleanUsername("李"), null, "at least two characters");
  assert.equal(cleanUsername("一二三四五六七八九十一二三四五六七八九十"), "一二三四五六七八九十一二三四五六七八九十");
  assert.equal(cleanUsername("一二三四五六七八九十一二三四五六七八九十一"), null, "at most twenty");
  for (const bad of ["a b", "mia!", "米娅@", "_".repeat(1) + " ", "", 42, null, "Guest", "游客", "ＡＤＭＩＮ"]) {
    assert.equal(cleanUsername(bad), null, String(bad));
  }
  assert.equal(usernameKey("Mia"), usernameKey("mia"));
  assert.equal(usernameKey("ｍｉａ"), "mia", "full-width letters are the same name");
  assert.equal(cleanEmail(undefined), "");
  assert.equal(cleanEmail("  "), "");
  assert.equal(cleanEmail(" Mia@Example.COM "), "mia@example.com");
  for (const bad of ["mia", "mia@", "mia@example", "a b@c.d", "x@guest.invalid", 3]) {
    assert.equal(cleanEmail(bad), null, String(bad));
  }
  assert.equal(isMadeUpEmail("abc@account.invalid"), true);
  assert.equal(isMadeUpEmail("mia@example.com"), false);
  assert.equal(passwordAllowed("1234567"), false);
  assert.equal(passwordAllowed("12345678"), true);
  assert.equal(passwordAllowed("x".repeat(129)), false);
  assert.equal(passwordAllowed(12345678), false);
});

test("passwords: PBKDF2 over a peppered HMAC, salted, and useless without the pepper", async () => {
  const stored = await hashPassword("correct horse", PEPPER);
  assert.match(stored, new RegExp(`^pbkdf2-sha256\\$${PASSWORD_ITERATIONS}\\$[A-Za-z0-9_-]{22}\\$[A-Za-z0-9_-]{43}$`, "u"));
  assert.notEqual(await hashPassword("correct horse", PEPPER), stored, "a new salt each time");
  assert.equal(await verifyPassword(stored, "correct horse", PEPPER), true);
  assert.equal(await verifyPassword(stored, "correct horsf", PEPPER), false);
  assert.equal(await verifyPassword(stored, "correct horse", `${PEPPER}x`), false, "another pepper");
  // The same password composed differently on another keyboard.
  assert.equal(await verifyPassword(await hashPassword("café-pass", PEPPER), "café-pass", PEPPER), true);
  // The iteration count is read from the stored value.
  assert.equal(await verifyPassword(await hashPassword("pw-12345", PEPPER, 1_000), "pw-12345", PEPPER), true);
  for (const broken of [null, "", "bcrypt$1$2$3", "pbkdf2-sha256$0$AA$AA", "pbkdf2-sha256$99999999$AA$AA",
    "pbkdf2-sha256$20000$!!$AA", stored.slice(0, -4)]) {
    assert.equal(await verifyPassword(broken, "correct horse", PEPPER), false, String(broken));
  }
  await assert.rejects(hashPassword("x", "short"), /PASSWORD_PEPPER/u);
});

test("registering: a username and a password, the email only if given", async () => {
  const env = accounts();
  const mia = browser(env);
  assert.deepEqual((await mia.call("/api/account")).json,
    { account: null, signIn: { passwords: true, google: false } });
  const made = await register(mia, { username: "棋手Mia", password: "secret-123" });
  assert.equal(made.status, 201);
  assert.deepEqual(made.json, { account: { guest: false, name: "棋手Mia", email: null } });
  assert.ok(made.setCookie.some((cookie) => /session_token=/u.test(cookie) && /HttpOnly/iu.test(cookie)));
  assert.deepEqual((await mia.call("/api/account")).json.account, { guest: false, name: "棋手Mia", email: null });
  const [user] = env.DB.rows("user");
  assert.equal(user.username, "棋手mia", "names compare without case");
  assert.match(user.email, /@account\.invalid$/u, "a made-up address that is never shown");
  const [account] = env.DB.rows("account");
  assert.equal(account.providerId, "credential");
  assert.match(account.password, /^pbkdf2-sha256\$/u);
  assert.equal(await verifyPassword(account.password, "secret-123", PEPPER), true);

  const lee = browser(env);
  const withEmail = await register(lee, { username: "Lee", password: "another-pass", email: "Lee@Example.com" });
  assert.deepEqual(withEmail.json.account, { guest: false, name: "Lee", email: "lee@example.com" });

  // What is refused, and why.
  const other = browser(env);
  const refusals = [
    [{ username: "棋手mia", password: "secret-123" }, 409, "USERNAME_TAKEN"],
    [{ username: "ＬＥＥ", password: "secret-123" }, 409, "USERNAME_TAKEN"],
    [{ username: "Zoe", password: "secret-123", email: "lee@example.com" }, 409, "EMAIL_TAKEN"],
    [{ username: "Z", password: "secret-123" }, 400, "BAD_USERNAME"],
    [{ username: "Guest", password: "secret-123" }, 400, "BAD_USERNAME"],
    [{ username: "Zoe", password: "short" }, 400, "BAD_PASSWORD"],
    [{ username: "Zoe", password: "secret-123", email: "zoe@" }, 400, "BAD_EMAIL"],
    [{ username: "Zoe", password: "secret-123", email: "zoe@x.invalid" }, 400, "BAD_EMAIL"],
  ];
  for (const [body, status, code] of refusals) {
    const refused = await register(other, body);
    assert.deepEqual([refused.status, refused.json.code], [status, code], JSON.stringify(body));
    assert.equal(typeof refused.json.error, "string");
  }
  assert.equal(env.DB.rows("user").length, 2, "nothing refused was created");
});

test("signing in with the username or the email; wrong ones read the same", async () => {
  const env = accounts();
  await register(browser(env), { username: "Mia", password: "secret-123", email: "mia@example.com" });
  for (const login of ["Mia", " mia ", "ＭＩＡ", "mia@example.com", "MIA@example.com"]) {
    const signedIn = await signIn(browser(env), login, "secret-123");
    assert.equal(signedIn.status, 200, login);
    assert.deepEqual(signedIn.json.account, { guest: false, name: "Mia", email: "mia@example.com" });
  }
  for (const [login, password] of [["Mia", "secret-124"], ["Nobody", "secret-123"], ["nobody@example.com", "secret-123"],
    ["x@account.invalid", "secret-123"], ["M", "secret-123"], ["", "secret-123"], ["Mia", ""], ["Mia", "x".repeat(200)]]) {
    const refused = await signIn(browser(env), login, password);
    assert.deepEqual([refused.status, refused.json.code], [401, "WRONG_LOGIN"], `${login} / ${password}`);
  }
});

test("signing out: the browser has nobody until it needs a guest again", async () => {
  const env = accounts();
  const mia = browser(env);
  await register(mia, { username: "Mia", password: "secret-123" });
  const out = await mia.call("/api/account/sign-out", { method: "POST" });
  assert.deepEqual([out.status, out.json], [200, { ok: true }]);
  assert.equal((await mia.call("/api/account")).json.account, null);
  assert.equal(env.DB.rows("session").length, 0, "the session is gone");
  // Saving a game afterwards makes a new guest, not the account.
  await mia.call("/api/records", { method: "POST", body: upload() });
  assert.deepEqual((await mia.call("/api/account")).json.account, { guest: true, name: null, email: null });
  assert.equal(env.DB.rows("user").length, 2);
  // Signing out twice, or without a session, is harmless.
  assert.equal((await browser(env).call("/api/account/sign-out", { method: "POST" })).status, 200);
});

test("a guest that registers keeps its games, and the account its seats", async () => {
  const env = accounts();
  const mia = browser(env);
  const game = upload();
  await mia.call("/api/records", { method: "POST", body: game });
  await mia.call("/api/rooms", { method: "POST", body: createBody() });
  const guestId = env.BADUK_ROOMS.calls[0].body.userId;
  assert.ok(guestId);
  assert.equal((await mia.call("/api/records")).json.records.length, 1);

  const made = await register(mia, { username: "Mia", password: "secret-123" });
  assert.equal(made.status, 201);
  const accountId = env.DB.rows("user").find((user) => user.username === "mia").id;
  assert.notEqual(accountId, guestId);
  assert.equal(env.DB.rows("user").length, 1, "the guest is gone");
  const list = (await mia.call("/api/records")).json;
  assert.deepEqual(list.account, { guest: false, name: "Mia", email: null });
  assert.equal(list.records.length, 1, "its game came along");
  assert.deepEqual(env.DB.rows("user_alias").map(({ old_id, new_id }) => [old_id, new_id]), [[guestId, accountId]]);

  // Rooms that knew the guest: joining tells the room both ids...
  await mia.call("/api/rooms/AB23CD/join", { method: "POST", body: joinBody("spectator") });
  const joined = env.BADUK_ROOMS.calls.at(-1).body;
  assert.equal(joined.userId, accountId);
  assert.deepEqual(joined.formerUserIds, [guestId]);
  // ...and so does a connection, which no client can claim.
  const forwarded = [];
  env.BADUK_ROOMS.getByName = () => ({
    async fetch(request) {
      forwarded.push([request.headers.get(SESSION_USER_HEADER), request.headers.get(SESSION_FORMER_USERS_HEADER)]);
      return new Response(null, { status: 204 });
    },
  });
  await mia.call("/api/rooms/AB23CD/socket", { headers: { Upgrade: "websocket", [SESSION_FORMER_USERS_HEADER]: "forged" } });
  await browser(env).call("/api/rooms/AB23CD/socket", { headers: { [SESSION_FORMER_USERS_HEADER]: guestId } });
  assert.deepEqual(forwarded, [[accountId, guestId], [null, null]]);

  // A game the room saves later under the guest id goes to the account.
  await saveRecord(env.DB, {
    client_key: "room:AB23CD:1:1", source: "online", mode: "friend", game_type: "go", width: 9, height: 9,
    topology: "torus", black_name: "Mia", white_name: "Lee", black_kind: "human", white_kind: "human",
    winner: "black", result: "B+R", move_count: 3, started_at: 1, finished_at: Date.now(), room_code: "AB23CD",
    data: "{}",
  }, [{ userId: guestId, color: "black" }, { userId: "someone-unknown", color: "white" }]);
  assert.equal((await mia.call("/api/records")).json.records.length, 2);
  assert.deepEqual(env.DB.rows("game_record_owner").filter(({ record_id }) =>
    env.DB.rows("game_record").find(({ id }) => id === record_id).client_key === "room:AB23CD:1:1")
    .map(({ user_id, color }) => [user_id, color]), [[accountId, "black"]], "nobody unknown owns it");
});

test("a guest that signs in to an existing account brings its games; the account keeps its own", async () => {
  const env = accounts();
  const home = browser(env);
  await register(home, { username: "Mia", password: "secret-123" });
  await home.call("/api/records", { method: "POST", body: upload() });

  const cafe = browser(env);
  await cafe.call("/api/records", { method: "POST", body: upload() });
  await cafe.call("/api/records", { method: "POST", body: upload() });
  const guestId = env.DB.rows("user").find((user) => user.isAnonymous === 1).id;
  const signedIn = await signIn(cafe, "Mia", "secret-123");
  assert.equal(signedIn.status, 200);
  assert.equal((await cafe.call("/api/records")).json.records.length, 3);
  assert.equal((await home.call("/api/records")).json.records.length, 3, "the same account everywhere");
  assert.equal(env.DB.rows("user").length, 1);
  assert.equal(env.DB.rows("user_alias")[0].old_id, guestId);

  // An account signing in to another account is not merged into it.
  const lee = browser(env);
  await register(lee, { username: "Lee", password: "secret-456" });
  await lee.call("/api/records", { method: "POST", body: upload() });
  await signIn(lee, "Mia", "secret-123");
  assert.equal((await lee.call("/api/records")).json.records.length, 3);
  assert.equal(env.DB.rows("user").length, 2, "Lee's account stays");
  assert.equal(env.DB.rows("user_alias").length, 1);
});

test("adopting a guest is all or nothing, and only guests are adopted", async (t) => {
  t.mock.method(console, "error", () => {});
  const env = accounts();
  const guest = browser(env);
  await guest.call("/api/records", { method: "POST", body: upload() });
  const account = browser(env);
  await register(account, { username: "Mia", password: "secret-123" });
  const [guestRow, accountRow] = [env.DB.rows("user").find((user) => user.isAnonymous === 1),
    env.DB.rows("user").find((user) => !user.isAnonymous)];
  env.DB.failing = true;
  assert.equal(await adoptGuest(env.DB, guestRow.id, accountRow.id), false);
  env.DB.failing = false;
  assert.equal(env.DB.rows("user").length, 2, "nothing changed");
  assert.equal(await adoptGuest(env.DB, guestRow.id, guestRow.id), false);
  assert.equal(await adoptGuest(null, guestRow.id, accountRow.id), false);
  // An account is never deleted as if it were a guest.
  assert.equal(await adoptGuest(env.DB, accountRow.id, guestRow.id), true);
  assert.ok(env.DB.rows("user").some((user) => user.id === accountRow.id));
  assert.deepEqual(await formerUserIds(env.DB, { id: guestRow.id, isAnonymous: true }), [], "guests have none");
  env.DB.failing = true;
  assert.deepEqual(await formerUserIds(env.DB, { id: accountRow.id }), []);
});

test("account routes check origin, method and budget; Better Auth's own routes stay closed", async () => {
  const env = accounts({
    SIGN_IN_RATE_LIMITER: { calls: 0, async limit() { this.calls += 1; return { success: this.calls <= 2 }; } },
  });
  const mia = browser(env);
  assert.equal((await mia.call("/api/account", { origin: "https://evil.test" })).status, 403);
  assert.equal((await mia.call("/api/account/register", { method: "POST", origin: "https://evil.test", body: {} })).status, 403);
  assert.equal((await mia.call("/api/account/register")).status, 405);
  assert.equal((await mia.call("/api/account", { method: "POST" })).status, 405);
  for (const path of ["/api/auth/sign-up/email", "/api/auth/sign-in/username", "/api/auth/sign-in/anonymous",
    "/api/auth/update-user", "/api/auth/delete-user", "/api/auth/list-sessions"]) {
    assert.equal((await mia.call(path, { method: "POST", body: {} })).status, 404, path);
  }
  assert.equal((await mia.call("/api/auth/get-session")).status, 200);
  // Registering and signing in have their own, tighter budget.
  env.SIGN_IN_RATE_LIMITER.calls = 0;
  assert.equal((await signIn(mia, "Mia", "secret-123")).status, 401);
  assert.equal((await signIn(mia, "Mia", "secret-123")).status, 401);
  assert.equal((await signIn(mia, "Mia", "secret-123")).status, 429);
  assert.equal((await register(mia, { username: "Mia", password: "secret-123" })).status, 429);
  assert.equal((await mia.call("/api/account")).status, 200, "reading who is signed in is not limited by it");
});

test("each sign-in method is off until its secrets are set", async (t) => {
  t.mock.method(console, "error", () => {});
  assert.equal(passwordsConfigured(environment()), false);
  assert.equal(passwordsConfigured(environment({ PASSWORD_PEPPER: "short" })), false);
  assert.equal(passwordsConfigured(accounts()), true);
  assert.equal(googleConfigured(accounts()), false);
  assert.equal(googleConfigured(accounts({ GOOGLE_CLIENT_ID: "id" })), false);
  assert.equal(googleConfigured(accounts({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" })), true);

  const noPepper = browser(environment());
  assert.deepEqual((await noPepper.call("/api/account")).json.signIn, { passwords: false, google: false });
  assert.equal((await register(noPepper, { username: "Mia", password: "secret-123" })).json.code, "AUTH_UNAVAILABLE");
  assert.equal((await signIn(noPepper, "Mia", "secret-123")).json.code, "AUTH_UNAVAILABLE");
  const noAuth = browser(environment({ BETTER_AUTH_SECRET: undefined, PASSWORD_PEPPER: PEPPER }));
  assert.equal((await noAuth.call("/api/account")).json.account, null);
  assert.equal((await noAuth.call("/api/account/sign-out", { method: "POST" })).json.code, "AUTH_UNAVAILABLE");
  assert.equal((await noAuth.call("/api/account/google", { method: "POST", body: {} })).json.code, "GOOGLE_UNAVAILABLE");
  assert.equal((await browser(accounts()).call("/api/account/google", { method: "POST", body: {} })).status, 404);
});

test("Google sign-in starts at Google and returns to the page it left", async () => {
  const env = accounts({ GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "client-secret" });
  const mia = browser(env);
  assert.deepEqual((await mia.call("/api/account")).json.signIn, { passwords: true, google: true });
  const started = await mia.call("/api/account/google", { method: "POST", body: { returnTo: "/records" } });
  assert.equal(started.status, 200);
  const url = new URL(started.json.url);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("client_id"), "client-id.apps.googleusercontent.com");
  assert.equal(url.searchParams.get("redirect_uri"), "https://baduk.test/api/auth/callback/google");
  assert.equal(url.searchParams.get("prompt"), "select_account");
  assert.ok(url.searchParams.get("state"));
  assert.ok(started.setCookie.some((cookie) => /topology-go.state=/u.test(cookie)), "the state cookie Google's answer is checked against");
  const returns = () => env.DB.rows("verification").map(({ value }) => JSON.parse(value))
    .map(({ callbackURL, errorURL }) => [callbackURL, errorURL]);
  assert.deepEqual(returns(), [["/records?signed-in=google", "/records?sign-in-failed=google"]]);
  // Only paths of this site to return to.
  for (const returnTo of ["https://evil.test/", "//evil.test", "/a?b=c", 3]) {
    const other = await browser(env).call("/api/account/google", { method: "POST", body: { returnTo } });
    assert.equal(other.status, 200, String(returnTo));
    assert.deepEqual(returns().at(-1), ["/?signed-in=google", "/?sign-in-failed=google"], String(returnTo));
  }
});
