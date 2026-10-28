// Codes by email against wrangler dev (npm run dev sets EMAIL_DEV_OUTBOX=1,
// so nothing is mailed: the codes are read back from /api/dev/outbox). An
// account registers with a username and a password, adds its email in
// account settings with a code, and forgets its password: on another
// browser it signs in with a code, the dialog stays on the new password
// (no current one asked), the old password stops working and the new one
// works; then it changes its email with a code, sees its ways to sign in
// and changes its username. The send button waits a minute between codes
// (the check waits one too), and it all reads in English. About 1.5 minutes.
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
  return { button: await text(pageValue, "#account-button-label"), error: await text(pageValue, "#account-error") };
}

process.on("uncaughtException", (error) => {
  console.log(JSON.stringify({ failed: error.stack, record, problems }, null, 2));
  process.exit(1);
});

const home = await page("home");
const phone = await page("phone");
try {
  // 1. Register (a username and a password), then add the email by code.
  await home.goto(`${BASE}/single`);
  await home.click("#account-button");
  await home.waitForSelector("#account-dialog[open]");
  await home.click('[data-account-tab="register"]');
  // The note changes once the dialog knows codes are on.
  await home.waitForFunction(() => /注册后可以在账号设置里绑定邮箱/u.test(document.querySelector("#account-register-note")?.textContent ?? ""), null, { timeout: 10_000 });
  record.registerNote = await text(home, "#account-register-note");
  await home.fill("#register-username", username);
  await home.fill("#register-password", oldPassword);
  await home.fill("#register-password-again", oldPassword);
  record.registerHasEmail = await home.locator("#register-email").count();
  await home.click("#register-submit");
  await home.waitForFunction((name) => document.querySelector("#account-button-label")?.textContent === name, username, { timeout: 15_000 });
  await home.goto(`${BASE}/settings#email`);
  await home.waitForSelector('[data-settings-panel="email"]:not([hidden])', { timeout: 10_000 });
  await home.fill("#settings-email-input", address);
  await home.click("#settings-email-send");
  await home.waitForFunction(() => /验证码已发到/u.test(document.querySelector("#settings-info")?.textContent ?? ""), null, { timeout: 10_000 });
  await home.fill("#settings-email-code", await codeFor(home, address));
  await home.click("#settings-email-confirm");
  await home.waitForFunction(() => /邮箱已验证/u.test(document.querySelector("#settings-info")?.textContent ?? ""), null, { timeout: 10_000 });
  // A minute between codes to one address.
  await home.waitForTimeout(61_000);

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
  // On to the new password in account settings.
  await phone.waitForURL(/\/settings#password$/u, { timeout: 15_000 });
  await phone.waitForSelector('[data-settings-panel="password"]:not([hidden])', { timeout: 10_000 });
  await phone.waitForFunction(() => /现在就可以直接设/u.test(document.querySelector("#settings-info")?.textContent ?? ""), null, { timeout: 10_000 });
  record.afterCode = {
    button: await text(phone, "#account-button-label"),
    info: await text(phone, "#settings-info"),
    currentPasswordAsked: await phone.locator("#settings-current-password-field:not([hidden])").count(),
    email: await text(phone, "#settings-email-fact"),
    password: await text(phone, "#settings-password-fact"),
  };
  record.codeShot = await shot(phone, "emailcodes-new-password");
  await phone.fill("#settings-new-password", newPassword);
  await phone.fill("#settings-new-password-again", newPassword);
  await phone.click("#settings-password-save");
  await phone.waitForFunction(() => /新密码已保存/u.test(document.querySelector("#settings-info")?.textContent ?? ""), null, { timeout: 10_000 });
  record.saved = await text(phone, "#settings-info");

  // 3. The old password no longer works; the new one does.
  const third = await page("third");
  record.oldPassword = await signInWithPassword(third, oldPassword);
  record.newPassword = await signInWithPassword(third, newPassword);

  // 4. A new email, confirmed with a code sent to it.
  await phone.click('[data-settings-section="email"]');
  await phone.fill("#settings-email-input", changedAddress);
  await phone.click("#settings-email-send");
  await phone.waitForFunction(() => /验证码已发到/u.test(document.querySelector("#settings-info")?.textContent ?? ""), null, { timeout: 10_000 });
  await phone.fill("#settings-email-code", await codeFor(phone, changedAddress));
  await phone.click("#settings-email-confirm");
  await phone.waitForFunction(() => /邮箱已验证/u.test(document.querySelector("#settings-info")?.textContent ?? ""), null, { timeout: 10_000 });
  record.changedEmail = await text(phone, "#settings-email-fact");

  // 5. The ways to sign in, and a new username.
  await phone.click('[data-settings-section="sign-in"]');
  record.methods = await phone.$$eval("#settings-methods .settings-method", (rows) =>
    rows.map((row) => [...row.querySelectorAll("strong, span, button")].map((part) => part.textContent.trim()).join(" ")));
  const newName = `改${Date.now() % 1_000_000}`;
  await phone.click('[data-settings-section="account"]');
  await phone.fill("#settings-username-input", newName);
  await phone.click("#settings-username-save");
  await phone.waitForFunction((name) => document.querySelector("#account-button-label")?.textContent === name, newName, { timeout: 10_000 });
  record.renamed = { info: await text(phone, "#settings-info"), username: await text(phone, "#settings-username"), expected: newName };

  // 6. English, the names and addresses aside.
  await phone.click('[data-language="en"]');
  await phone.click('[data-settings-section="account"]');
  await phone.waitForTimeout(600);
  record.english = {
    email: await text(phone, "#settings-email-fact"),
    leftovers: (await cjkLeftovers(phone)).filter((value) => !value.includes(username) && !value.includes(record.renamed.expected)),
  };
  record.englishShot = await shot(phone, "emailcodes-english");
} catch (error) {
  record.error = error.stack;
  record.failShots = [await shot(home, "emailcodes-fail-home"), await shot(phone, "emailcodes-fail-phone")];
}
await browser.close();

const ok = !record.error &&
  /注册后可以在账号设置里绑定邮箱/u.test(record.registerNote ?? "") && record.registerHasEmail === 0 &&
  new RegExp(`如果 ${address.replace(/[.]/gu, "\\.")} 是这个网站上某个账号的邮箱`, "u").test(record.sent?.info ?? "") &&
  /^重新发送（\d+）$/u.test(record.sent?.button ?? "") && record.codeShape &&
  record.afterCode?.button === username && /现在就可以直接设一个新密码/u.test(record.afterCode.info) &&
  record.afterCode.currentPasswordAsked === 0 && /（已验证）/u.test(record.afterCode.email) &&
  record.afterCode.password === "已设置" &&
  /新密码已保存/u.test(record.saved ?? "") &&
  record.oldPassword?.error === "用户名（或邮箱）或密码不对。" && record.newPassword?.button === username &&
  record.changedEmail === `${changedAddress}（已验证）` &&
  record.methods?.length === 2 && /用户名和密码 已设置/u.test(record.methods[0]) &&
  record.methods[1].includes(changedAddress) &&
  record.renamed?.username === record.renamed.expected && /用户名已改成/u.test(record.renamed.info) &&
  record.english?.email === `${changedAddress} (confirmed)` && record.english.leftovers.length === 0;
// The refused old password (step 3) is the point of that step.
const unexpected = problems.filter((problem) => !/^\[third\] console\.error: Failed to load resource: .*401/u.test(problem));
console.log(JSON.stringify({ ok, record, problems: unexpected }, null, 2));
process.exitCode = ok && unexpected.length === 0 ? 0 : 1;
