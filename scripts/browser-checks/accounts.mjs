// Accounts end to end against wrangler dev (npm run dev, which sets a local
// PASSWORD_PEPPER): a guest finishes a game, registers and keeps it; on a
// second browser the same account signs in, finds the game, and a room
// link takes it back to the seat it took on the first one; signing out
// forgets the account and the room identities there, a wrong password is
// refused, signing in again brings the games back, and the dialog reads in
// English; last, the account is deleted (its username typed to confirm) and
// no longer signs in. The account and its password are made up for each
// run. About a minute.
import { randomBytes } from "node:crypto";

import { BASE, cjkLeftovers, clickPoint, configureBoard, launch, openPage, problems, scanBoard, setView, shot, startLocalGame, text } from "./lib.mjs";
import { installCspWatch } from "./play.mjs";

const browser = await launch();
const record = {};
const username = `检查${Date.now() % 1_000_000}`;
const password = randomBytes(12).toString("base64url");

async function page(name, locale = "zh-CN") {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  await context.addInitScript((value) => {
    try { localStorage.setItem("3d-baduk-locale-v1", value); } catch {}
  }, locale);
  await installCspWatch(context);
  const { page: created } = await openPage(browser, { context, name, locale });
  return created;
}

async function recordsOn(pageValue) {
  await pageValue.goto(`${BASE}/records`);
  await pageValue.waitForFunction(() => !/正在读取|Loading/u.test(document.querySelector("#records-status")?.textContent ?? ""), null, { timeout: 15_000 });
  return {
    games: await pageValue.$$eval("#records-list .record-item", (items) => items.map((item) => item.dataset.recordId)),
    guestNote: await pageValue.locator("#records-guest-note:not([hidden])").count(),
  };
}

async function openAccount(pageValue) {
  await pageValue.click("#account-button");
  await pageValue.waitForSelector("#account-dialog[open]");
}

async function signIn(pageValue, login, secret) {
  await openAccount(pageValue);
  await pageValue.click("#account-method-password");
  await pageValue.fill("#sign-in-login", login);
  await pageValue.fill("#sign-in-password", secret);
  await pageValue.click("#sign-in-submit");
}

process.on("uncaughtException", (error) => {
  console.log(JSON.stringify({ failed: error.stack, record, problems }, null, 2));
  process.exit(1);
});

const home = await page("home");
const phone = await page("phone");

try {
  // 1. A guest finishes a Gomoku game on one page (5 x 5 cylinder).
  await home.goto(`${BASE}/single`);
  await home.waitForTimeout(800);
  await configureBoard(home, { gameType: "gomoku", ruleSet: "freestyle", topology: "cylinder", width: 5, height: 5 });
  await setView(home, "flat");
  await startLocalGame(home);
  const map = await scanBoard(home);
  for (const [row, col] of [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2], [0, 3], [2, 3], [0, 4]]) {
    await clickPoint(home, map, row, col, 5);
    await home.waitForTimeout(150);
  }
  await home.waitForFunction(() => /对局结束|Game over/u.test(document.querySelector("#phase-label")?.textContent ?? ""), null, { timeout: 10_000 });
  await home.waitForTimeout(1_500);
  record.guestList = await recordsOn(home);

  // 2. The guest registers from the note on My games and keeps the game.
  await home.click("#records-register");
  await home.waitForSelector("#account-dialog[open]");
  await home.click("#account-method-password");
  await home.click('[data-account-panel="sign-in"] [data-account-go="register"]');
  await home.fill("#register-username", username);
  await home.fill("#register-password", password);
  await home.fill("#register-password-again", `${password}x`);
  await home.click("#register-submit");
  record.mismatch = await text(home, "#account-error");
  await home.fill("#register-password-again", password);
  await home.click("#register-submit");
  await home.waitForFunction((name) => document.querySelector("#account-button-label")?.textContent === name, username, { timeout: 15_000 });
  record.registered = { button: await text(home, "#account-button-label"), dialogOpen: await home.locator("#account-dialog[open]").count() };
  record.accountList = await recordsOn(home);
  record.registeredShot = await shot(home, "accounts-registered");

  // 3. The account takes Black in a new, unlisted Go room.
  await home.goto(`${BASE}/lobby`);
  await home.waitForTimeout(700);
  await home.click("#lobby-create-room");
  await home.waitForSelector("#online-dialog[open]");
  await home.click('#online-dialog [data-game-type="go"]');
  record.prefilledName = await home.inputValue("#player-name");
  await home.fill("#player-name", "家里的我");
  await home.check("#room-unlisted");
  await home.click("#create-room");
  await home.waitForURL(/\/online\/[A-Z0-9]{6}/u, { timeout: 20_000 });
  const code = /\/online\/([A-Z0-9]{6})/u.exec(home.url())[1];
  record.code = code;

  // 4. Another browser: nothing yet; signing in finds the game.
  record.phoneBefore = await recordsOn(phone);
  await signIn(phone, username, password);
  await phone.waitForFunction((name) => document.querySelector("#account-button-label")?.textContent === name, username, { timeout: 15_000 });
  record.phoneList = await recordsOn(phone);

  // 5. The room link on that browser: asking only to watch returns to the
  // seat this account has there.
  await phone.goto(`${BASE}/online/${code}`);
  await phone.waitForSelector("#online-dialog[open]");
  if (!(await phone.inputValue("#player-name"))) await phone.fill("#player-name", "手机上的我");
  await phone.click("#watch-room");
  await phone.waitForFunction(() => !document.querySelector("#online-dialog")?.open, null, { timeout: 15_000 });
  await phone.waitForFunction(() => /家里的我/u.test(document.querySelector("#black-seat")?.textContent ?? ""), null, { timeout: 15_000 });
  record.rejoin = { message: await text(phone, "#message"), blackSeat: await text(phone, "#black-seat") };
  record.rejoinShot = await shot(phone, "accounts-rejoin");

  // 6. Signing out (the menu under the name) forgets the account and its
  // room identities on that browser.
  await phone.click("#account-button");
  await phone.waitForSelector("#account-menu:not([hidden])");
  record.menu = await phone.$$eval("#account-menu .account-menu-item", (items) => items.map((item) => item.textContent.trim()));
  await phone.click("#account-menu-sign-out");
  await phone.waitForURL(/\/single$/u, { timeout: 15_000 });
  await phone.waitForFunction(() => /已退出登录/u.test(document.querySelector("#message")?.textContent ?? ""), null, { timeout: 10_000 });
  record.signedOut = {
    button: await text(phone, "#account-button-label"),
    roomStored: await phone.evaluate((roomCode) => Object.keys(localStorage)
      .some((key) => key.includes(roomCode) || (localStorage.getItem(key) ?? "").includes(roomCode)), code),
    list: await recordsOn(phone),
  };

  // 7. A wrong password is refused; the right one brings the game back.
  await signIn(phone, username, `${password}-wrong`);
  await phone.waitForFunction(() => !document.querySelector("#account-error")?.hidden, null, { timeout: 10_000 });
  record.wrongPassword = await text(phone, "#account-error");
  await phone.fill("#sign-in-password", password);
  await phone.click("#sign-in-submit");
  await phone.waitForFunction((name) => document.querySelector("#account-button-label")?.textContent === name, username, { timeout: 15_000 });
  record.signedInAgain = await recordsOn(phone);

  // 8. Account settings in English, the name aside.
  // (Each page load starts in Chinese here: the context sets it.)
  await phone.goto(`${BASE}/settings`);
  await phone.waitForSelector("#settings-body:not([hidden])", { timeout: 10_000 });
  await phone.click('[data-language="en"]');
  await phone.waitForTimeout(400);
  record.english = {
    title: await text(phone, "#settings-account-title"),
    leftovers: (await cjkLeftovers(phone)).filter((value) => !value.includes(username)),
  };
  record.englishShot = await shot(phone, "accounts-english");

  // 9. Deleting the account: just signed in, so the username is enough.
  await phone.goto(`${BASE}/settings`);
  await phone.waitForSelector("#settings-body:not([hidden])", { timeout: 10_000 });
  record.deleteForm = {
    passwordAsked: await phone.locator("#settings-delete-password-field:not([hidden])").count(),
    signInNote: await phone.locator("#settings-delete-note:not([hidden])").count(),
  };
  record.deleteShot = await shot(phone, "accounts-delete");
  await phone.fill("#settings-delete-username", `${username}x`);
  await phone.click("#settings-delete-submit");
  await phone.waitForFunction(() => !document.querySelector("#settings-error")?.hidden, null, { timeout: 10_000 });
  record.wrongUsername = await text(phone, "#settings-error");
  await phone.fill("#settings-delete-username", username);
  await phone.click("#settings-delete-submit");
  await phone.waitForURL(/\/single$/u, { timeout: 15_000 });
  await phone.waitForFunction(() => /账号已删除/u.test(document.querySelector("#message")?.textContent ?? ""), null, { timeout: 10_000 });
  record.deleted = { message: await text(phone, "#message"), button: await text(phone, "#account-button-label") };
  await signIn(phone, username, password);
  await phone.waitForFunction(() => !document.querySelector("#account-error")?.hidden, null, { timeout: 10_000 });
  record.afterDelete = await text(phone, "#account-error");
} catch (error) {
  record.error = error.stack;
  record.failShots = [await shot(home, "accounts-fail-home"), await shot(phone, "accounts-fail-phone")];
}
await browser.close();

const ok = !record.error &&
  record.guestList?.games.length === 1 && record.guestList.guestNote === 1 &&
  record.mismatch === "两次输入的密码不一样。" &&
  record.registered?.button === username && record.registered.dialogOpen === 0 &&
  record.accountList?.games[0] === record.guestList.games[0] && record.accountList.guestNote === 0 &&
  record.prefilledName === username &&
  record.phoneBefore?.games.length === 0 && record.phoneBefore.guestNote === 1 &&
  record.phoneList?.games[0] === record.guestList.games[0] && record.phoneList.guestNote === 0 &&
  /已回到原来的身份：黑方/u.test(record.rejoin?.message ?? "") &&
  record.signedOut?.button === "登录" && record.signedOut.roomStored === false &&
  record.signedOut.list.games.length === 0 &&
  record.wrongPassword === "用户名（或邮箱）或密码不对。" &&
  record.signedInAgain?.games[0] === record.guestList.games[0] &&
  record.menu?.join("|") === "我的棋谱|账号设置|退出登录" &&
  record.english?.title === "Account" && record.english.leftovers.length === 0 &&
  record.deleteForm?.passwordAsked === 0 && record.deleteForm.signInNote === 0 &&
  record.wrongUsername === "输入的用户名和这个账号的不一样。" &&
  record.deleted?.message === "账号已删除。" && record.deleted.button === "登录" &&
  record.afterDelete === "用户名（或邮箱）或密码不对。";
// The refused sign-ins (steps 7 and 9) and the mistyped username (step 9)
// are the point of those steps.
const unexpected = problems.filter((problem) =>
  !/^\[phone\] console\.error: Failed to load resource: .*40[01]/u.test(problem));
console.log(JSON.stringify({ ok, record, problems: unexpected }, null, 2));
process.exitCode = ok && unexpected.length === 0 ? 0 : 1;
