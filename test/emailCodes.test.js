import assert from "node:assert/strict";
import test from "node:test";

import { EmailLimitError, codeMessage, devOutboxFor, emailCodesConfigured, sendCodeEmail } from "../worker/email.js";
import { FakeD1 } from "./helpers/d1.js";
import { PEPPER, browser, environment, upload } from "./helpers/site.js";

/*
 * Codes by email (worker/email.js): signing in without a password, which is
 * also how a forgotten password is replaced (sign in with a code, then set
 * a new one), and confirming an email added to an account. The owner pays
 * for no email, so the site caps what it sends.
 */

const withCodes = (overrides = {}) => environment({ PASSWORD_PEPPER: PEPPER, EMAIL_DEV_OUTBOX: "1", ...overrides });
const post = (who, path, body = {}) => who.call(path, { method: "POST", body });
const codeFor = (env, address) => devOutboxFor(env, address)?.code ?? null;

/** Register with a username and password, then give the account a confirmed email. */
async function registerWithEmail(env, who, username, password, address) {
  await post(who, "/api/account/register", { username, password });
  env.DB.database.prepare(`UPDATE "user" SET email = ?, "emailVerified" = 1 WHERE username = ?`)
    .run(address, username.toLowerCase());
}
let serial = 0;
const fresh = (name) => `${name}${serial += 1}`;

test("codes are off until the mail service is set", async () => {
  assert.equal(emailCodesConfigured({}), false);
  assert.equal(emailCodesConfigured({ DB: new FakeD1() }), false);
  assert.equal(emailCodesConfigured({ DB: new FakeD1(), RESEND_API_KEY: "re_x" }), false);
  assert.equal(emailCodesConfigured({ DB: new FakeD1(), RESEND_API_KEY: "re_x", EMAIL_FROM: "Topology Go <a@b.c>" }), true);
  assert.equal(emailCodesConfigured({ DB: new FakeD1(), EMAIL_DEV_OUTBOX: "1" }), true);
  const off = browser(environment({ PASSWORD_PEPPER: PEPPER }));
  assert.equal((await off.call("/api/account")).json.signIn.emailCodes, false);
  assert.equal((await post(off, "/api/account/email-code", { email: "a@example.com" })).json.code, "EMAIL_CODES_UNAVAILABLE");
  assert.equal((await post(off, "/api/account/email-sign-in", { email: "a@example.com", code: "123456" })).json.code, "EMAIL_CODES_UNAVAILABLE");
  assert.equal((await browser(withCodes()).call("/api/account")).json.signIn.emailCodes, true);
});

test("a forgotten password: sign in with a code, then set a new one", async () => {
  const env = withCodes();
  const name = fresh("Mia");
  const address = `${name.toLowerCase()}@example.com`;
  const home = browser(env);
  await registerWithEmail(env, home, name, "old-password", address);

  // Another browser, the password forgotten.
  const phone = browser(env);
  const asked = await post(phone, "/api/account/email-code", { email: address.toUpperCase() });
  assert.deepEqual([asked.status, asked.json], [200, { ok: true, resendAfter: 60 }]);
  const sent = devOutboxFor(env, address);
  assert.equal(sent.type, "sign-in");
  assert.match(sent.code, /^\d{6}$/u);
  assert.match(sent.subject, new RegExp(sent.code, "u"));
  // Codes are stored hashed: the database never holds one that works.
  assert.ok(env.DB.rows("verification").every(({ value }) => !value.includes(sent.code)));

  const wrong = await post(phone, "/api/account/email-sign-in", { email: address, code: sent.code === "000000" ? "111111" : "000000" });
  assert.deepEqual([wrong.status, wrong.json.code], [400, "WRONG_CODE"]);
  assert.equal((await post(phone, "/api/account/email-sign-in", { email: address, code: "12" })).json.code, "WRONG_CODE");
  const signedIn = await post(phone, "/api/account/email-sign-in", { email: address, code: sent.code });
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.json.account.name, name);
  assert.equal((await post(phone, "/api/account/email-sign-in", { email: address, code: sent.code })).json.code, "WRONG_CODE", "a code works once");

  const me = (await phone.call("/api/account")).json.account;
  assert.deepEqual([me.emailVerified, me.hasPassword], [true, true]);
  assert.ok(me.freshUntil > Date.now());

  // Just signed in: a new password needs no current one; the old one stops.
  const set = await post(phone, "/api/account/password", { password: "new-password" });
  assert.equal(set.status, 200);
  assert.equal(set.json.account.hasPassword, true);
  assert.equal((await post(browser(env), "/api/account/sign-in", { login: name, password: "old-password" })).status, 401);
  assert.equal((await post(browser(env), "/api/account/sign-in", { login: name, password: "new-password" })).status, 200);
});

test("an unknown address gets the same answer and no mail", async () => {
  const env = withCodes();
  const answer = await post(browser(env), "/api/account/email-code", { email: "nobody-here@example.com" });
  assert.deepEqual([answer.status, answer.json], [200, { ok: true, resendAfter: 60 }]);
  assert.equal(devOutboxFor(env, "nobody-here@example.com"), null);
  assert.equal(env.DB.rows("email_send").length, 0, "nothing counted against the caps");
  for (const email of ["", "not-an-email", "x@account.invalid"]) {
    assert.equal((await post(browser(env), "/api/account/email-code", { email })).json.code, "BAD_EMAIL", email);
  }
});

test("later, a new password needs the current one, and signs out everywhere else", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const env = withCodes();
  const name = fresh("Lee");
  const laptop = browser(env);
  await post(laptop, "/api/account/register", { username: name, password: "first-password" });
  const tablet = browser(env);
  await post(tablet, "/api/account/sign-in", { login: name, password: "first-password" });
  t.mock.timers.tick(11 * 60 * 1_000);

  const missing = await post(laptop, "/api/account/password", { password: "second-password" });
  assert.deepEqual([missing.status, missing.json.code], [400, "NEED_CURRENT_PASSWORD"]);
  const wrong = await post(laptop, "/api/account/password", { password: "second-password", currentPassword: "nope-nope" });
  assert.deepEqual([wrong.status, wrong.json.code], [401, "WRONG_PASSWORD"]);
  assert.equal((await post(laptop, "/api/account/password", { password: "short", currentPassword: "first-password" })).json.code, "BAD_PASSWORD");
  const changed = await post(laptop, "/api/account/password", { password: "second-password", currentPassword: "first-password" });
  assert.equal(changed.status, 200);
  assert.equal(env.DB.rows("session").length, 1, "the tablet's sign-in ended");
  assert.equal((await tablet.call("/api/account")).json.account, null);
  assert.equal((await laptop.call("/api/account")).json.account.name, name);
  assert.equal((await post(browser(env), "/api/account/sign-in", { login: name, password: "second-password" })).status, 200);

  // Guests and nobody cannot.
  assert.equal((await post(browser(env), "/api/account/password", { password: "whatever-1" })).json.code, "NOT_SIGNED_IN");
  const guest = browser(env);
  await guest.call("/api/records", { method: "POST", body: upload() });
  assert.equal((await post(guest, "/api/account/password", { password: "whatever-1" })).json.code, "NOT_SIGNED_IN");
});

test("adding, confirming and changing an email", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const env = withCodes();
  const name = fresh("Zoe");
  const zoe = browser(env);
  await post(zoe, "/api/account/register", { username: name, password: "zoe-password" });
  const address = `${name.toLowerCase()}@example.com`;
  const asked = await post(zoe, "/api/account/email", { email: address });
  assert.equal(asked.status, 200);
  assert.equal(devOutboxFor(env, address).type, "change-email");
  assert.equal((await post(zoe, "/api/account/email/confirm", { email: address, code: "999999" === codeFor(env, address) ? "888888" : "999999" })).json.code, "WRONG_CODE");
  const confirmed = await post(zoe, "/api/account/email/confirm", { email: address, code: codeFor(env, address) });
  assert.equal(confirmed.status, 200);
  assert.deepEqual([confirmed.json.account.email, confirmed.json.account.emailVerified], [address, true]);
  assert.equal((await zoe.call("/api/account")).json.account.email, address);
  assert.equal((await post(zoe, "/api/account/email", { email: address })).json.code, "EMAIL_ALREADY_VERIFIED");

  // A confirmed email signs in with a code (a minute after the last one)
  // and keeps the password.
  assert.equal((await post(browser(env), "/api/account/email-code", { email: address })).json.code, "EMAIL_COOLDOWN");
  t.mock.timers.tick(61_000);
  const other = browser(env);
  await post(other, "/api/account/email-code", { email: address });
  await post(other, "/api/account/email-sign-in", { email: address, code: codeFor(env, address) });
  assert.equal((await other.call("/api/account")).json.account.hasPassword, true);
  assert.equal((await post(browser(env), "/api/account/sign-in", { login: address, password: "zoe-password" })).status, 200);

  // Someone else's address is refused up front.
  const taken = fresh("Taken");
  await registerWithEmail(env, browser(env), taken, "taken-password", `${taken.toLowerCase()}@example.com`);
  assert.equal((await post(zoe, "/api/account/email", { email: `${taken.toLowerCase()}@example.com` })).json.code, "EMAIL_TAKEN");

  // (Unconfirmed emails from before are gone: migration 0004, test/signInMethods.test.js.)
  assert.equal((await post(browser(env), "/api/account/email", { email: "someone@example.com" })).json.code, "NOT_SIGNED_IN");
});

test("a guest signing in with a code keeps its games", async () => {
  const env = withCodes();
  const name = fresh("Ann");
  const address = `${name.toLowerCase()}@example.com`;
  await registerWithEmail(env, browser(env), name, "ann-password", address);
  const cafe = browser(env);
  await cafe.call("/api/records", { method: "POST", body: upload() });
  await post(cafe, "/api/account/email-code", { email: address });
  await post(cafe, "/api/account/email-sign-in", { email: address, code: codeFor(env, address) });
  const list = (await cafe.call("/api/records")).json;
  assert.equal(list.account.name, name);
  assert.equal(list.records.length, 1);
  assert.equal(env.DB.rows("user_alias").length, 1);
});

test("caps: a minute between codes, five an hour per address, a daily total", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 27, 3) });
  const db = new FakeD1();
  const env = { DB: db, EMAIL_DEV_OUTBOX: "1", EMAIL_DAILY_LIMIT: "7" };
  const send = (email) => sendCodeEmail(env, { email, otp: "123456", type: "sign-in" }, Date.now());
  const refusedAs = (code) => (error) => error instanceof EmailLimitError && error.code === code;
  await send("a@example.com");
  await assert.rejects(send("a@example.com"), (error) => refusedAs("EMAIL_COOLDOWN")(error) && error.retryAfterSeconds === 60);
  for (let index = 0; index < 4; index += 1) {
    t.mock.timers.tick(61_000);
    await send("a@example.com");
  }
  t.mock.timers.tick(61_000);
  await assert.rejects(send("a@example.com"), refusedAs("EMAIL_ADDRESS_LIMIT"));
  await send("b@example.com");
  await send("c@example.com");
  await assert.rejects(send("d@example.com"), (error) =>
    refusedAs("EMAIL_DAILY_LIMIT")(error) && error.retryAfterSeconds > 0 && error.retryAfterSeconds <= 21 * 3_600);
  assert.equal(db.rows("email_send").length, 7, "a refused code is not counted");
  // The next day (UTC) starts afresh; old rows go.
  t.mock.timers.tick(3 * 24 * 3_600_000);
  await send("d@example.com");
  assert.equal(db.rows("email_send").length, 1);

  // Through the route: the reader is told when to try again.
  const routeEnv = withCodes();
  const name = fresh("Cap");
  const address = `${name.toLowerCase()}@example.com`;
  await registerWithEmail(routeEnv, browser(routeEnv), name, "cap-password", address);
  const first = await post(browser(routeEnv), "/api/account/email-code", { email: address });
  assert.equal(first.status, 200);
  const second = await post(browser(routeEnv), "/api/account/email-code", { email: address });
  assert.deepEqual([second.status, second.json.code, second.json.retryAfter], [429, "EMAIL_COOLDOWN", 60]);
  assert.equal(second.headers.get("Retry-After"), "60");
});

test("the mail goes to Resend; its refusals stop codes, never cost anything", async (t) => {
  const calls = [];
  let reply = () => new Response(JSON.stringify({ id: "mail-1" }), { status: 200 });
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    return reply();
  });
  t.mock.method(console, "error", () => {});
  const env = { DB: new FakeD1(), RESEND_API_KEY: "re_test_key", EMAIL_FROM: "Topology Go <noreply@example.org>" };
  await sendCodeEmail(env, { email: "mia@example.com", otp: "424242", type: "sign-in" });
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].init.headers.Authorization, "Bearer re_test_key");
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual([body.from, body.to], ["Topology Go <noreply@example.org>", ["mia@example.com"]]);
  assert.match(body.subject, /424242/u);
  assert.match(body.text, /424242.*10 分钟/u);
  assert.match(body.text, /valid for 10 minutes/u);

  reply = () => new Response("{}", { status: 429 });
  await assert.rejects(sendCodeEmail(env, { email: "b@example.com", otp: "1", type: "sign-in" }), { code: "EMAIL_DAILY_LIMIT" });
  reply = () => new Response("{}", { status: 500 });
  await assert.rejects(sendCodeEmail(env, { email: "c@example.com", otp: "1", type: "sign-in" }), { code: "EMAIL_SEND_FAILED" });
  reply = () => { throw new TypeError("offline"); };
  await assert.rejects(sendCodeEmail(env, { email: "d@example.com", otp: "1", type: "sign-in" }), { code: "EMAIL_SEND_FAILED" });
  await assert.rejects(sendCodeEmail({ DB: new FakeD1() }, { email: "e@example.com", otp: "1", type: "sign-in" }), { code: "EMAIL_CODES_UNAVAILABLE" });
  // Confirming an address reads differently.
  assert.match(codeMessage("change-email", "123123").subject, /邮箱验证码：123123/u);
});

test("Better Auth's own email routes stay closed; the outbox exists only in development", async () => {
  const dev = browser(withCodes());
  for (const path of ["/api/auth/email-otp/send-verification-otp", "/api/auth/sign-in/email-otp",
    "/api/auth/email-otp/request-email-change", "/api/auth/email-otp/reset-password"]) {
    assert.equal((await post(dev, path, { email: "a@example.com", type: "sign-in" })).status, 404, path);
  }
  assert.equal((await dev.call("/api/dev/outbox?to=nobody@example.com")).status, 404);
  assert.equal((await browser(environment({ PASSWORD_PEPPER: PEPPER })).call("/api/dev/outbox?to=a@example.com")).status, 404);
});
