// Codes by email against wrangler dev (npm run dev sets EMAIL_DEV_OUTBOX=1,
// so nothing is mailed: the codes are read back from /api/dev/outbox). An
// account registered with an email forgets its password: on another
// browser it signs in with a code, the dialog stays on the new password
// (no current one asked), the old password stops working and the new one
// works; then it changes its email with a code. The send button waits a
// minute between codes, and the dialog reads in English. About 20 seconds.
import { randomBytes } from "node:crypto";

import { BASE, cjkLeftovers, launch, openPage, problems, shot, text } from "./lib.mjs";
import { installCspWatch } from "./play.mjs";

const browser = await launch();
const record = {};
const username = `码${Date.now() % 1_000_000}`;
const address = `code-check-${Date.now()}@example.com`;
const changedAddress = `code-check-${Date.now()}-new@example.com`;
const oldPassword = randomBytes(12).toString("base64url");
const newPassword = randomBytes(12).toString("base64url");

async function page(name) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    try { localStorage.setItem("3d-baduk-locale-v1", "zh-CN"); } catch {}
  });
  await installCspWatch(context);
  const { page: created } = await openPage(browser, { context, name, locale: "zh-CN" });
  return created;
}

async function codeFor(pageValue, to) {
  return pageValue.evaluate(async (target) => {
    const response = await fetch(`/api/dev/outbox?to=${encodeURIComponent(target)}`);
    return response.ok ? (await response.json()).code : null;
  }, to);
}

async function signInWithPassword(pageValue, password) {
  await pageValue.goto(`${BASE}/single`);
  await pageValue.click("#account-button");
  await pageValue.waitForSelector("#account-dialog[open]");
  await pageValue.fill("#sign-in-login", username);
  await pageValue.fill("#sign-in-password", password);
  await pageValue.click("#sign-in-submit");
  await pageValue.waitForTimeout(1_200);
  return { button: await text(pageValue, "#account-button"), error: await text(pageValue, "#account-error") };
}

process.on("uncaughtException", (error) => {
  console.log(JSON.stringify({ failed: error.stack, record, problems }, null, 2));
  process.exit(1);
});

const home = await page("home");
const phone = await page("phone");
try {
  // 1. Register with an email.
  await home.goto(`${BASE}/single`);
  await home.click("#account-button");
  await home.waitForSelector("#account-dialog[open]");
  await home.click('[data-account-tab="register"]');
  // The note changes once the dialog knows codes are on.
  await home.waitForFunction(() => /建议填邮箱/u.test(document.querySelector("#account-register-note")?.textContent ?? ""), null, { timeout: 10_000 });
  record.registerNote = await text(home, "#account-register-note");
  await home.fill("#register-username", username);
  await home.fill("#register-password", oldPassword);
  await home.fill("#register-password-again", oldPassword);
  await home.fill("#register-email", address);
  await home.click("#register-submit");
  await home.waitForFunction((name) => document.querySelector("#account-button")?.textContent === name, username, { timeout: 15_000 });

  // 2. Another browser, the password forgotten: a code instead.
  await phone.goto(`${BASE}/single`);
  await phone.click("#account-button");
  await phone.waitForSelector("#account-dialog[open]");
  await phone.waitForSelector("#account-use-code:not([hidden])", { timeout: 10_000 });
  await phone.click("#account-use-code");
  await phone.fill("#code-email", address);
  await phone.click("#code-send");
  await phone.waitForFunction(() => !document.querySelector("#account-info")?.hidden, null, { timeout: 10_000 });
  record.sent = { info: await text(phone, "#account-info"), button: await text(phone, "#code-send") };
  const code = await codeFor(phone, address);
  record.codeShape = /^\d{6}$/u.test(code ?? "");
  await phone.fill("#code-input", code);
  await phone.click("#code-sign-in");
  await phone.waitForFunction((name) => document.querySelector("#account-button")?.textContent === name, username, { timeout: 15_000 });
  await phone.waitForSelector("#account-password-form:not([hidden])", { timeout: 10_000 });
  record.afterCode = {
    dialogOpen: await phone.locator("#account-dialog[open]").count(),
    info: await text(phone, "#account-info"),
    currentPasswordAsked: await phone.locator("#account-current-password-field:not([hidden])").count(),
    email: await text(phone, "#account-email"),
    noPassword: await phone.locator("#account-password-state:not([hidden])").count(),
  };
  record.codeShot = await shot(phone, "emailcodes-new-password");
  await phone.fill("#account-new-password", newPassword);
  await phone.fill("#account-new-password-again", newPassword);
  await phone.click("#account-password-save");
  await phone.waitForFunction(() => /新密码已保存/u.test(document.querySelector("#account-info")?.textContent ?? ""), null, { timeout: 10_000 });
  record.saved = await text(phone, "#account-info");

  // 3. The old password no longer works; the new one does.
  const third = await page("third");
  record.oldPassword = await signInWithPassword(third, oldPassword);
  record.newPassword = await signInWithPassword(third, newPassword);

  // 4. A new email, confirmed with a code sent to it.
  await phone.click("#account-email-edit");
  await phone.fill("#account-email-input", changedAddress);
  await phone.click("#account-email-send");
  await phone.waitForFunction(() => /验证码已发到/u.test(document.querySelector("#account-info")?.textContent ?? ""), null, { timeout: 10_000 });
  await phone.fill("#account-email-code", await codeFor(phone, changedAddress));
  await phone.click("#account-email-confirm");
  await phone.waitForFunction(() => /邮箱已验证/u.test(document.querySelector("#account-info")?.textContent ?? ""), null, { timeout: 10_000 });
  record.changedEmail = await text(phone, "#account-email");

  // 5. English, the names and addresses aside.
  await phone.click("#account-done");
  await phone.click('[data-language="en"]');
  await phone.click("#account-button");
  await phone.waitForSelector("#account-dialog[open]");
  await phone.waitForTimeout(600);
  record.english = {
    email: await text(phone, "#account-email"),
    leftovers: (await cjkLeftovers(phone)).filter((value) => !value.includes(username)),
  };
  record.englishShot = await shot(phone, "emailcodes-english");
} catch (error) {
  record.error = error.stack;
  record.failShots = [await shot(home, "emailcodes-fail-home"), await shot(phone, "emailcodes-fail-phone")];
}
await browser.close();

const ok = !record.error &&
  /建议填邮箱/u.test(record.registerNote ?? "") &&
  new RegExp(`如果 ${address.replace(/[.]/gu, "\\.")} 是这个网站上某个账号的邮箱`, "u").test(record.sent?.info ?? "") &&
  /^重新发送（\d+）$/u.test(record.sent?.button ?? "") && record.codeShape &&
  record.afterCode?.dialogOpen === 1 && /现在就可以直接设一个新密码/u.test(record.afterCode.info) &&
  record.afterCode.currentPasswordAsked === 0 && /（已验证）/u.test(record.afterCode.email) &&
  /新密码已保存/u.test(record.saved ?? "") &&
  record.oldPassword?.error === "用户名（或邮箱）或密码不对。" && record.newPassword?.button === username &&
  record.changedEmail === `邮箱：${changedAddress}（已验证）` &&
  record.english?.email === `Email: ${changedAddress} (confirmed)` && record.english.leftovers.length === 0;
// The refused old password (step 3) is the point of that step.
const unexpected = problems.filter((problem) => !/^\[third\] console\.error: Failed to load resource: .*401/u.test(problem));
console.log(JSON.stringify({ ok, record, problems: unexpected }, null, 2));
process.exitCode = ok && unexpected.length === 0 ? 0 : 1;
