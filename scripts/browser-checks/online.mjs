// Online Gomoku/Othello AI rooms: the host browser runs the AI seat.
// Room 1: Gomoku (Renju, torus) human vs AI; a guest joins the room and a
// spectator watches; direct undo of an AI round; played to a result.
// Room 2: Othello (Möbius) AI vs AI with pause / undo / resume, watched by
// an English spectator, to the end.
import { BASE, launch, openPage, problems, scanBoard, setView, shot, text, cjkLeftovers } from "./lib.mjs";
import { installCspWatch, log, moveCount } from "./play.mjs";

const browser = await launch();
const results = [];

async function page(name, locale = "zh-CN") {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript((value) => {
    try { localStorage.setItem("3d-baduk-locale-v1", value); } catch {}
  }, locale);
  await installCspWatch(context);
  return (await openPage(browser, { context, name, locale })).page;
}

async function createRoom(host, { gameType, name }) {
  await host.goto(`${BASE}/lobby`);
  await host.waitForTimeout(800);
  await host.click("#lobby-create-room");
  await host.waitForSelector("#online-dialog[open]");
  await host.click(`#online-dialog [data-game-type="${gameType}"]`);
  await host.fill("#player-name", name);
  await host.click("#create-room");
  await host.waitForURL(/\/online\/[A-Z0-9]{6}/u, { timeout: 20_000 });
  await host.waitForTimeout(900);
  return /\/online\/([A-Z0-9]{6})/u.exec(host.url())[1];
}

async function join(pageValue, code, { name, role }) {
  await pageValue.goto(`${BASE}/online/${code}?role=${role}`);
  await pageValue.waitForSelector("#online-dialog[open]");
  await pageValue.fill("#player-name", name);
  await pageValue.click(role === "spectator" ? "#watch-room" : "#join-room");
  await pageValue.waitForFunction(() => !document.querySelector("#online-dialog")?.open, null, { timeout: 15_000 });
  await pageValue.waitForTimeout(800);
}

async function waitCount(pageValue, count, timeout = 20_000) {
  await pageValue.waitForFunction((n) => {
    const value = document.querySelector("#move-number")?.textContent ?? "";
    return value.includes(`第 ${n + 1} 手`) || value.includes(`Move ${n + 1}`) ||
      value.startsWith(`${n} 手`) || value.startsWith(`${n} move`);
  }, count, { timeout });
}

async function waitFinished(pageValue, timeout = 240_000) {
  await pageValue.waitForFunction(() => /对局结束|Game over/u.test(
    document.querySelector("#phase-label")?.textContent ?? "",
  ), null, { timeout });
}

async function hostTurn(host) {
  return /轮到你了/u.test(await text(host, "#room-hint")) && !(await host.locator("#message.error").count() && false);
}

/** The host clicks empty points until the room accepts one. */
async function hostPlays(host, map) {
  const before = await moveCount(host);
  for (const key of Object.keys(map).sort(() => Math.random() - 0.5)) {
    const point = map[key];
    await host.mouse.move(point.x, point.y);
    await host.mouse.down();
    await host.mouse.up();
    try {
      await host.waitForFunction((n) => {
        const value = document.querySelector("#move-number")?.textContent ?? "";
        const match = /第 (\d+) 手/u.exec(value);
        const done = /^(\d+) 手/u.exec(value);
        return (match && Number(match[1]) - 1 > n) || (done && Number(done[1]) > n) ||
          document.querySelector("#message")?.classList.contains("error");
      }, before, { timeout: 5_000 });
    } catch {
      continue;
    }
    if ((await moveCount(host)) > before || /对局结束/u.test(await text(host, "#phase-label"))) return key;
    await host.waitForTimeout(150);
  }
  throw new Error("no point accepted");
}

async function humanVsAIRoom() {
  const host = await page("host");
  const guest = await page("guest");
  const spectator = await page("spectator");
  const record = { tag: "online-gomoku-renju-torus-human-ai" };
  const code = await createRoom(host, { gameType: "gomoku", name: "Host" });
  record.code = code;
  await host.click('[data-sidebar-tab="settings"]');
  await host.selectOption("#gomoku-rule", "renju");
  await host.click('.settings [data-board-topology="torus"]');
  await host.selectOption("#online-match-mode", "human-ai");
  await host.waitForTimeout(300);
  record.setup = {
    modelOptions: await host.$$eval("#online-match-ai-model option", (options) => options.map((o) => `${o.value}:${o.textContent}`)),
    levelVisible: await host.locator("#online-match-ai-level-field").isVisible(),
  };
  await host.selectOption("#online-match-ai-level", "normal");
  record.setupShot = await shot(host, "online-gomoku-setup");
  await host.click("#confirm-next-game");
  await host.waitForFunction(() => /第 1 手/u.test(document.querySelector("#move-number")?.textContent ?? ""), null, { timeout: 15_000 });
  await join(guest, code, { name: "Guest", role: "player" });
  await join(spectator, code, { name: "Watcher", role: "spectator" });
  record.seatsSeenByGuest = [await text(guest, "#black-seat"), await text(guest, "#white-seat")];
  record.guestRole = await text(guest, "#local-role");

  await host.click('[data-sidebar-tab="game"]');
  await setView(host, "flat");
  const map = await scanBoard(host, { step: 5 });

  // The guest cannot move for the AI seat.
  await guest.click('[data-sidebar-tab="game"]');
  await setView(guest, "flat");
  const guestMap = await scanBoard(guest, { step: 5 });
  const guestPoint = Object.values(guestMap)[40];
  await guest.mouse.click(guestPoint.x, guestPoint.y);
  await guest.waitForTimeout(300);
  record.guestClickMessage = await text(guest, "#message");

  // Two rounds, then undo the last round directly.
  for (let round = 0; round < 2; round += 1) {
    await host.waitForFunction(() => /轮到你了/u.test(document.querySelector("#room-hint")?.textContent ?? ""), null, { timeout: 20_000 });
    await hostPlays(host, map);
  }
  await host.waitForFunction(() => /轮到你了/u.test(document.querySelector("#room-hint")?.textContent ?? ""), null, { timeout: 20_000 });
  const before = await moveCount(host);
  record.undoLabel = await text(host, "#undo-button");
  await host.click("#undo-button");
  await waitCount(host, before - 2);
  await waitCount(spectator, before - 2);
  record.undo = { before, host: await moveCount(host), spectator: await moveCount(spectator), message: await text(host, "#message") };

  let rounds = 0;
  while (!/对局结束/u.test(await text(host, "#phase-label"))) {
    if (rounds++ > 120) throw new Error("online game too long");
    await host.waitForFunction(() => /轮到你了/u.test(document.querySelector("#room-hint")?.textContent ?? "") ||
      /对局结束/u.test(document.querySelector("#phase-label")?.textContent ?? ""), null, { timeout: 30_000 });
    if (/对局结束/u.test(await text(host, "#phase-label"))) break;
    await hostPlays(host, map);
  }
  await waitFinished(spectator, 20_000);
  await waitFinished(guest, 20_000);
  record.result = {
    host: await text(host, "#turn-text"),
    guest: await text(guest, "#turn-text"),
    spectator: await text(spectator, "#turn-text"),
    moves: [await moveCount(host), await moveCount(guest), await moveCount(spectator)],
  };
  record.spectatorSeats = [await text(spectator, "#black-seat"), await text(spectator, "#white-seat")];
  record.hostShot = await shot(host, "online-gomoku-host-end");
  await spectator.click('[data-sidebar-tab="game"]');
  await setView(spectator, "flat");
  record.spectatorShot = await shot(spectator, "online-gomoku-spectator-end");
  record.ok = record.undo.host === before - 2 && record.undo.spectator === before - 2 &&
    record.result.host === record.result.spectator && record.result.host === record.result.guest &&
    new Set(record.result.moves).size === 1;
  results.push(record);
  log(record.tag, record.ok, record.result);
  for (const p of [host, guest, spectator]) await p.context().close();
}

async function aiVsAIRoom() {
  const host = await page("host2");
  const spectator = await page("spectator2", "en");
  const record = { tag: "online-othello-mobius-ai-ai" };
  const code = await createRoom(host, { gameType: "othello", name: "Host" });
  record.code = code;
  await host.click('[data-sidebar-tab="settings"]');
  await host.click('.settings [data-board-topology="mobius"]');
  await host.selectOption("#online-match-mode", "ai-ai");
  await host.waitForTimeout(300);
  record.setup = {
    blackModel: await host.$$eval("#online-match-black-ai-model option", (options) => options.map((o) => `${o.value}:${o.textContent}`)),
    blackLevelVisible: await host.locator("#online-match-black-ai-level-field").isVisible(),
    whiteLevelVisible: await host.locator("#online-match-ai-level-field").isVisible(),
  };
  await host.selectOption("#online-match-black-ai-level", "hard");
  await host.selectOption("#online-match-ai-level", "easy");
  await host.click("#confirm-next-game");
  await join(spectator, code, { name: "Watcher", role: "spectator" });
  await spectator.click('[data-sidebar-tab="game"]');
  await setView(spectator, "flat");
  await spectator.waitForFunction(() => {
    const value = document.querySelector("#move-number")?.textContent ?? "";
    const match = /(?:第 |Move )(\d+)/u.exec(value);
    return match && Number(match[1]) >= 7;
  }, null, { timeout: 30_000 });
  record.spectatorMidShot = await shot(spectator, "online-othello-spectator-mid");
  record.spectatorLeftovers = await cjkLeftovers(spectator);
  record.spectatorSeats = [await text(spectator, "#black-seat"), await text(spectator, "#white-seat")];
  record.spectatorHint = await text(spectator, "#room-hint");

  // Pause, take back one move, resume.
  await host.click('[data-sidebar-tab="game"]');
  await host.click("#toggle-online-ai-autoplay");
  await host.waitForFunction(() => /继续对弈/u.test(document.querySelector("#toggle-online-ai-autoplay")?.textContent ?? ""), null, { timeout: 15_000 });
  await host.waitForTimeout(600);
  const pausedAt = await moveCount(host);
  await host.waitForTimeout(1200);
  record.stayedPaused = (await moveCount(host)) === pausedAt;
  await host.waitForFunction(() => !document.querySelector("#undo-button")?.disabled, null, { timeout: 10_000 });
  await host.click("#undo-button");
  await waitCount(host, pausedAt - 1);
  await waitCount(spectator, pausedAt - 1);
  record.undo = { before: pausedAt, host: await moveCount(host), spectator: await moveCount(spectator), message: await text(host, "#message") };
  record.pausedShot = await shot(host, "online-othello-host-paused");
  await host.click("#toggle-online-ai-autoplay");
  await waitFinished(host);
  await waitFinished(spectator, 20_000);
  record.result = {
    host: await text(host, "#turn-text"),
    spectator: await text(spectator, "#turn-text"),
    moves: [await moveCount(host), await moveCount(spectator)],
  };
  record.hostShot = await shot(host, "online-othello-host-end");
  record.spectatorShot = await shot(spectator, "online-othello-spectator-end");
  record.spectatorEndLeftovers = await cjkLeftovers(spectator);
  record.ok = record.stayedPaused && record.undo.host === pausedAt - 1 &&
    record.undo.spectator === pausedAt - 1 && record.result.moves[0] === record.result.moves[1] &&
    record.spectatorLeftovers.length === 0 && record.spectatorEndLeftovers.length === 0;
  results.push(record);
  log(record.tag, record.ok, record.result);
  for (const p of [host, spectator]) await p.context().close();
}

try {
  if (!process.argv.includes("--only-ai-ai")) await humanVsAIRoom();
  await aiVsAIRoom();
} catch (error) {
  console.log("FAILED", error.stack);
}
console.log(JSON.stringify(results, null, 1));
console.log("PROBLEMS", JSON.stringify(problems, null, 1));
await browser.close();
