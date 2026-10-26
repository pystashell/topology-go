// My games end to end against wrangler dev: a Gomoku game played by two
// people on one page is saved when it ends and replays from /records; an
// online friend game is saved for both players (a guest each), a stranger
// cannot open it, and removing it from one list leaves the other player's
// copy. The list reads in English too. About a minute.
import { BASE, cjkLeftovers, clickPoint, configureBoard, launch, openPage, problems, scanBoard, setView, shot, startLocalGame, text } from "./lib.mjs";
import { finished, installCspWatch } from "./play.mjs";

const browser = await launch();
const record = {};

async function page(name, locale = "zh-CN") {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  await context.addInitScript((value) => {
    try { localStorage.setItem("3d-baduk-locale-v1", value); } catch {}
  }, locale);
  await installCspWatch(context);
  const { page: created } = await openPage(browser, { context, name, locale });
  created.on("dialog", (dialog) => dialog.accept());
  return created;
}

async function recordsOn(pageValue) {
  await pageValue.goto(`${BASE}/records`);
  await pageValue.waitForFunction(() => !/正在读取|Loading/u.test(document.querySelector("#records-status")?.textContent ?? ""), null, { timeout: 15_000 });
  return pageValue.$$eval("#records-list .record-item", (items) => items.map((item) => ({
    id: item.dataset.recordId,
    text: item.textContent.replace(/\s+/gu, " ").trim(),
  })));
}

process.on("uncaughtException", (error) => {
  console.log(JSON.stringify({ failed: error.stack, record, problems }, null, 2));
  process.exit(1);
});

const solo = await page("solo");
const host = await page("host");
const guest = await page("guest");
const stranger = await page("stranger");

try {
  // 1. Two people on one page play Gomoku on a 5 x 5 cylinder; Black makes five.
  await solo.goto(`${BASE}/single`);
  await solo.waitForTimeout(800);
  await configureBoard(solo, { gameType: "gomoku", ruleSet: "freestyle", topology: "cylinder", width: 5, height: 5 });
  await setView(solo, "flat");
  await startLocalGame(solo);
  const map = await scanBoard(solo);
  for (const [row, col] of [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2], [0, 3], [2, 3], [0, 4]]) {
    await clickPoint(solo, map, row, col, 5);
    await solo.waitForTimeout(150);
  }
  await solo.waitForFunction(() => /对局结束|Game over/u.test(document.querySelector("#phase-label")?.textContent ?? ""), null, { timeout: 10_000 });
  record.localFinished = await finished(solo);
  await solo.waitForTimeout(1_500);

  // 2. It is in My games, and replays from its own link.
  const soloList = await recordsOn(solo);
  record.localList = soloList;
  record.recordsShot = await shot(solo, "records-list");
  await solo.click(`#records-list [data-record-id="${soloList[0]?.id}"] a.primary-button`);
  await solo.waitForURL(/\/game\/[a-z0-9]{16}$/u, { timeout: 10_000 });
  await solo.waitForSelector("#replay-panel:not([hidden])", { timeout: 15_000 });
  record.localReplay = { url: solo.url(), message: await text(solo, "#message"), progress: await text(solo, "#replay-progress") };
  record.replayShot = await shot(solo, "records-replay");

  // 3. An online friend game: the host creates an unlisted Go room, the
  // guest takes White from the link, the host plays, the guest resigns.
  await host.goto(`${BASE}/lobby`);
  await host.waitForTimeout(700);
  await host.click("#lobby-create-room");
  await host.waitForSelector("#online-dialog[open]");
  await host.click('#online-dialog [data-game-type="go"]');
  await host.fill("#player-name", "房主甲");
  await host.check("#room-unlisted");
  await host.click("#create-room");
  await host.waitForURL(/\/online\/[A-Z0-9]{6}/u, { timeout: 20_000 });
  const code = /\/online\/([A-Z0-9]{6})/u.exec(host.url())[1];
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
  const hostMap = await scanBoard(host);
  // The room's board size: the highest row label seen.
  const hostHeight = Math.max(...Object.keys(hostMap).map((key) => Number(key.replace(/^[A-Z]+/u, ""))));
  await clickPoint(host, hostMap, 2, 2, hostHeight);
  await guest.waitForFunction(() => /白方落子|White to play|轮到你/u.test(`${document.querySelector("#turn-text")?.textContent} ${document.querySelector("#room-hint")?.textContent}`), null, { timeout: 15_000 });
  await guest.click('[data-sidebar-tab="game"]');
  await guest.click("#resign-button");
  await guest.click("#confirm-resign");
  await host.waitForFunction(() => /对局结束|认输|Game over/u.test(document.querySelector("#phase-label")?.textContent ?? ""), null, { timeout: 15_000 });
  await host.waitForTimeout(1_500);

  // 4. Both players find it; a stranger cannot open it.
  const hostList = await recordsOn(host);
  const guestList = await recordsOn(guest);
  const online = hostList.find((entry) => /联机对局/u.test(entry.text));
  record.online = { host: online, guestSame: guestList.some((entry) => entry.id === online?.id), guestText: guestList[0]?.text };
  await stranger.goto(`${BASE}/game/${online?.id}`);
  await stranger.waitForFunction(() => /只有对局双方能看/u.test(document.querySelector("#message")?.textContent ?? ""), null, { timeout: 15_000 });
  record.stranger = { message: await text(stranger, "#message"), replaying: await stranger.locator("#replay-panel:not([hidden])").count() };

  // 5. The guest removes it (two clicks); the host keeps it.
  await guest.click(`#records-list [data-record-remove="${online?.id}"]`);
  record.armed = await text(guest, `#records-list [data-record-remove="${online?.id}"]`);
  await guest.click(`#records-list [data-record-remove="${online?.id}"]`);
  await guest.waitForFunction((id) => !document.querySelector(`#records-list [data-record-id="${id}"]`), online?.id, { timeout: 10_000 });
  record.afterRemove = {
    guest: (await recordsOn(guest)).some((entry) => entry.id === online?.id),
    host: (await recordsOn(host)).some((entry) => entry.id === online?.id),
  };

  // 6. The list in English (player names aside), and the game filter.
  await host.click('[data-language="en"]');
  await host.waitForTimeout(400);
  const names = new Set(["房主甲", "客人乙"]);
  record.english = {
    text: await text(host, "#records-list .record-item"),
    leftovers: (await cjkLeftovers(host)).filter((value) => !names.has(value)),
  };
  await host.click('[data-language="zh-CN"]');
  await host.click('[data-records-game="gomoku"]');
  await host.waitForTimeout(800);
  record.filtered = await host.$$eval("#records-list .record-item", (items) => items.length);
} catch (error) {
  record.error = error.stack;
  record.failShots = [await shot(solo, "records-fail-solo"), await shot(host, "records-fail-host"), await shot(guest, "records-fail-guest")];
}
await browser.close();

const ok = !record.error &&
  record.localFinished &&
  /五子棋/u.test(record.localList?.[0]?.text ?? "") && /同机双人/u.test(record.localList?.[0]?.text ?? "") &&
  /黑方连成五子获胜/u.test(record.localList?.[0]?.text ?? "") && /9 手/u.test(record.localList?.[0]?.text ?? "") &&
  /\/game\/[a-z0-9]{16}$/u.test(record.localReplay?.url ?? "") && /黑方连成五子获胜/u.test(record.localReplay?.message ?? "") &&
  /房主甲/u.test(record.online?.host?.text ?? "") && /客人乙/u.test(record.online?.host?.text ?? "") &&
  /黑方胜 · 白方认输/u.test(record.online?.host?.text ?? "") && record.online?.guestSame &&
  /只有对局双方能看/u.test(record.stranger?.message ?? "") && record.stranger?.replaying === 0 &&
  record.armed === "确认移除" && record.afterRemove?.guest === false && record.afterRemove?.host === true &&
  /Online game/u.test(record.english?.text ?? "") && record.english?.leftovers.length === 0 &&
  record.filtered === 0;
// The stranger's refused request is the point of step 4, not a problem.
const unexpected = problems.filter((problem) => !/^\[stranger\] console\.error: Failed to load resource: .*403/u.test(problem));
console.log(JSON.stringify({ ok, record, problems: unexpected }, null, 2));
process.exitCode = ok && unexpected.length === 0 ? 0 : 1;
