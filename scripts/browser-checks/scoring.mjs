// A Go count nobody confirms: host and guest (English page) both pass, both
// see the two-minute countdown, and after it the room confirms the current
// marks on its own. About 2.5 minutes.
import { BASE, cjkLeftovers, launch, openPage, problems, shot, text } from "./lib.mjs";
import { installCspWatch, log } from "./play.mjs";

const browser = await launch();
const record = { tag: "scoring" };
process.on("uncaughtException", (error) => {
  console.log(JSON.stringify({ failed: error.message, record, problems }, null, 2));
  process.exit(1);
});

async function page(name, locale = "zh-CN") {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript((value) => {
    try { localStorage.setItem("3d-baduk-locale-v1", value); } catch {}
  }, locale);
  await installCspWatch(context);
  const { page: created } = await openPage(browser, { context, name, locale });
  created.on("dialog", (dialog) => dialog.accept());
  return created;
}

const host = await page("host");
const guest = await page("guest", "en");

await host.goto(`${BASE}/lobby`);
await host.waitForTimeout(800);
await host.click("#lobby-create-room");
await host.waitForSelector("#online-dialog[open]");
await host.click('#online-dialog [data-game-type="go"]');
await host.fill("#player-name", "Host");
await host.check("#room-unlisted");
await host.click("#create-room");
await host.waitForURL(/\/online\/[A-Z0-9]{6}/u, { timeout: 20_000 });
const code = /\/online\/([A-Z0-9]{6})/u.exec(host.url())[1];
record.code = code;

await guest.goto(`${BASE}/online/${code}?role=player`);
await guest.waitForSelector("#online-dialog[open]");
await guest.fill("#player-name", "Guest");
await guest.click("#join-room");
await guest.waitForFunction(() => !document.querySelector("#online-dialog")?.open, null, { timeout: 15_000 });
await host.waitForTimeout(800);

await host.click('[data-sidebar-tab="settings"]');
await host.selectOption("#online-match-mode", "friend");
await host.click("#confirm-next-game");
await guest.waitForSelector("#game-invitation-panel:not([hidden])", { timeout: 15_000 });
await guest.click("#accept-game-invitation");
await host.waitForTimeout(800);

// Black then White pass: the count begins.
await host.click('[data-sidebar-tab="game"]');
await guest.click('[data-sidebar-tab="game"]');
await host.click("#pass-button");
await guest.waitForFunction(() => !document.querySelector("#pass-button")?.disabled, null, { timeout: 10_000 });
await guest.click("#pass-button");
await host.waitForSelector("#scoring-countdown:not([hidden])", { timeout: 10_000 });
await guest.waitForSelector("#scoring-countdown:not([hidden])", { timeout: 10_000 });
record.countdown = { host: await text(host, "#scoring-countdown"), guest: await text(guest, "#scoring-countdown") };
record.guestLeftovers = await cjkLeftovers(guest);
await shot(host, "scoring-countdown");

await host.waitForFunction(() => /自动确认：/u.test(document.querySelector("#message")?.textContent ?? ""), null, { timeout: 150_000 });
await guest.waitForFunction(() => /confirmed/u.test(document.querySelector("#message")?.textContent ?? ""), null, { timeout: 10_000 });
record.after = {
  hostMessage: await text(host, "#message"),
  guestMessage: await text(guest, "#message"),
  hostPhase: await text(host, "#phase-label"),
  countdownHidden: await host.locator("#scoring-countdown").isHidden(),
};
await shot(host, "scoring-confirmed");

record.ok = /^[12]:\d{2} 后按当前死子标记自动确认/u.test(record.countdown.host) &&
  /^The count is confirmed with the current dead-stone marks in [12]:\d{2}/u.test(record.countdown.guest) &&
  record.guestLeftovers.length === 0 &&
  /^点目时间到，已按当前死子标记自动确认：/u.test(record.after.hostMessage) &&
  record.after.countdownHidden;
log("scoring", record.ok);
await browser.close();
console.log(JSON.stringify({ record, problems }, null, 2));
process.exitCode = record.ok && problems.length === 0 ? 0 : 1;
