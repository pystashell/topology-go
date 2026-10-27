// Rooms close by themselves against wrangler dev, in real time (about seven
// minutes): a host who waits alone and leaves loses the room after 2
// minutes; after a finished game whose players both left, the room closes
// after 5, the spectator still watching keeps the final position to replay,
// and a player opening the room's link again lands on that game in My games.
import { BASE, clickPoint, launch, openPage, problems, scanBoard, setView, shot, text } from "./lib.mjs";
import { installCspWatch } from "./play.mjs";

const browser = await launch();
const record = {};
const contexts = {};

async function page(name) {
  contexts[name] ??= await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  const context = contexts[name];
  await context.addInitScript(() => {
    try { localStorage.setItem("3d-baduk-locale-v1", "zh-CN"); } catch {}
  });
  await installCspWatch(context);
  const { page: created } = await openPage(browser, { context, name, locale: "zh-CN" });
  created.on("dialog", (dialog) => dialog.accept());
  return created;
}

async function createRoom(pageValue, name) {
  await pageValue.goto(`${BASE}/lobby`);
  await pageValue.waitForTimeout(700);
  await pageValue.click("#lobby-create-room");
  await pageValue.waitForSelector("#online-dialog[open]");
  await pageValue.click('#online-dialog [data-game-type="go"]');
  await pageValue.fill("#player-name", name);
  await pageValue.check("#room-unlisted");
  await pageValue.click("#create-room");
  await pageValue.waitForURL(/\/online\/[A-Z0-9]{6}/u, { timeout: 20_000 });
  return /\/online\/([A-Z0-9]{6})/u.exec(pageValue.url())[1];
}

process.on("uncaughtException", (error) => {
  console.log(JSON.stringify({ failed: error.stack, record, problems }, null, 2));
  process.exit(1);
});

try {
  // 1. A host creates a room and leaves before anyone comes.
  const lone = await page("lone");
  const loneCode = await createRoom(lone, "孤单房主");
  await lone.waitForFunction(() => /离开超过 2 分钟/u.test(document.querySelector("#room-hint")?.textContent ?? ""), null, { timeout: 15_000 });
  record.loneHint = await text(lone, "#room-hint");
  await lone.waitForTimeout(1_000);
  await lone.close();
  const loneLeftAt = Date.now();

  // 2. A friend game, finished by resignation, with a spectator.
  const host = await page("host");
  const guest = await page("guest");
  const viewer = await page("viewer");
  const code = await createRoom(host, "房主甲");
  record.code = code;
  await guest.goto(`${BASE}/online/${code}?role=player`);
  await guest.waitForSelector("#online-dialog[open]");
  await guest.fill("#player-name", "客人乙");
  await guest.click("#join-room");
  await guest.waitForFunction(() => !document.querySelector("#online-dialog")?.open, null, { timeout: 15_000 });
  await host.waitForTimeout(800);
  await host.click('[data-sidebar-tab="settings"]');
  await host.selectOption("#online-match-mode", "friend");
  await host.click("#confirm-next-game");
  await guest.waitForSelector("#game-invitation-panel:not([hidden])", { timeout: 15_000 });
  await guest.click("#accept-game-invitation");
  await host.waitForTimeout(1_200);
  await setView(host, "flat");
  const map = await scanBoard(host);
  const height = Math.max(...Object.keys(map).map((key) => Number(key.replace(/^[A-Z]+/u, ""))));
  await clickPoint(host, map, 2, 2, height);
  await guest.waitForFunction(() => /白方落子|White to play|轮到你/u.test(`${document.querySelector("#turn-text")?.textContent} ${document.querySelector("#room-hint")?.textContent}`), null, { timeout: 15_000 });
  await viewer.goto(`${BASE}/online/${code}?role=spectator`);
  await viewer.waitForSelector("#online-dialog[open]");
  await viewer.fill("#player-name", "观众丙");
  await viewer.click("#watch-room");
  await viewer.waitForFunction(() => !document.querySelector("#online-dialog")?.open, null, { timeout: 15_000 });
  await guest.click('[data-sidebar-tab="game"]');
  await guest.click("#resign-button");
  await guest.click("#confirm-resign");
  await host.waitForFunction(() => /对局结束|认输|Game over/u.test(document.querySelector("#phase-label")?.textContent ?? ""), null, { timeout: 15_000 });
  await viewer.waitForFunction(() => /对局结束|认输/u.test(document.querySelector("#phase-label")?.textContent ?? ""), null, { timeout: 15_000 });
  await host.waitForTimeout(1_500);
  await host.close();
  await guest.close();
  const playersLeftAt = Date.now();

  // 3. Two minutes later the lone host's room is gone: coming back says so.
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, loneLeftAt + 2 * 60_000 + 15_000 - Date.now())));
  const loneBack = await page("lone");
  await loneBack.goto(`${BASE}/online/${loneCode}`);
  await loneBack.waitForFunction(() => /已经关闭|没有找到这个房间/u.test(document.querySelector("#message")?.textContent ?? ""), null, { timeout: 30_000 });
  record.loneBack = { message: await text(loneBack, "#message"), url: loneBack.url() };

  // 4. Five minutes after both players left: the spectator keeps the game.
  await viewer.waitForFunction(() => /房间已经关闭/u.test(document.querySelector("#message")?.textContent ?? ""),
    null, { timeout: Math.max(30_000, playersLeftAt + 5 * 60_000 + 60_000 - Date.now()) });
  record.closedAfter = Math.round((Date.now() - playersLeftAt) / 1000);
  await viewer.waitForTimeout(1_500);
  record.viewer = {
    message: await text(viewer, "#message"),
    replaying: await viewer.locator("#replay-panel:not([hidden])").count(),
    progress: await text(viewer, "#replay-progress"),
  };
  record.viewerShot = await shot(viewer, "lifecycle-viewer");

  // 5. The host opens the room's link again: the last game played there.
  const hostBack = await page("host");
  await hostBack.goto(`${BASE}/online/${code}`);
  await hostBack.waitForURL(/\/game\/[a-z0-9]{16}$/u, { timeout: 30_000 });
  await hostBack.waitForSelector("#replay-panel:not([hidden])", { timeout: 15_000 });
  record.hostBack = { url: hostBack.url(), message: await text(hostBack, "#message") };
  record.hostShot = await shot(hostBack, "lifecycle-host-back");
} catch (error) {
  record.error = error.stack;
}
await browser.close();

const ok = !record.error &&
  /离开超过 2 分钟房间会关闭/u.test(record.loneHint ?? "") &&
  /已经关闭|没有找到这个房间/u.test(record.loneBack?.message ?? "") &&
  record.closedAfter >= 5 * 60 - 5 && record.closedAfter <= 5 * 60 + 70 &&
  /房间已经关闭；这盘棋可以接着回看/u.test(record.viewer?.message ?? "") && record.viewer.replaying === 1 &&
  /\/game\/[a-z0-9]{16}$/u.test(record.hostBack?.url ?? "") &&
  new RegExp(`房间 ${record.code} 已经关闭；这是你在里面下的最后一盘`, "u").test(record.hostBack?.message ?? "");
// The sockets of the closed rooms are refused on purpose.
const unexpected = problems.filter((problem) => !/WebSocket|Failed to load resource: .*404/u.test(problem));
console.log(JSON.stringify({ ok, record, problems: unexpected }, null, 2));
process.exitCode = ok && unexpected.length === 0 ? 0 : 1;
