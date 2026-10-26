// The lobby end to end against wrangler dev, with four browsers: a host
// creates a public Go room on their own; another player finds it in the
// lobby (search, filters, sort, counts, presence) and takes it with Quick
// join; the host starts a friend game; a viewer watches from the lobby; an
// English lobby sees it all translated; the guest drops off the network and
// comes back (room hints, seat presence, lobby dots); the host leaves and
// returns through "My rooms"; an unlisted room stays out of the public list
// but shows in "My rooms" and can be removed there; a card copies the room
// link; a resignation takes the finished game out of the lobby (My rooms
// keeps it). About two minutes.
import { BASE, cjkLeftovers, launch, openPage, problems, shot, text } from "./lib.mjs";
import { installCspWatch } from "./play.mjs";

const browser = await launch();
const record = {};

async function page(name, locale = "zh-CN") {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  await context.addInitScript((value) => {
    try { localStorage.setItem("3d-baduk-locale-v1", value); } catch {}
  }, locale);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  await installCspWatch(context);
  const { page: created } = await openPage(browser, { context, name, locale });
  created.on("dialog", (dialog) => dialog.accept());
  return created;
}

/** Refresh the lobby until `check` (run in the page) is true. */
async function untilLobby(pageValue, check, arg, { tries = 20, label = "lobby" } = {}) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (await pageValue.evaluate(check, arg)) return true;
    await pageValue.click("#lobby-refresh").catch(() => {});
    await pageValue.waitForTimeout(900);
  }
  throw new Error(`${label}: condition not reached`);
}

/** Chinese text left on an English page, player names (typed by people) aside. */
async function englishLeftovers(pageValue) {
  const names = new Set(await pageValue.$$eval(".lobby-room-players > span:not(.versus) > span, #black-seat, #white-seat",
    (nodes) => nodes.map((node) => node.textContent.trim())));
  return (await cjkLeftovers(pageValue)).filter((value) => !names.has(value) && !/^(房主甲|客人乙|观众丙)$/u.test(value));
}

function card(code) {
  return `.lobby-room-card[data-room-code="${code}"]`;
}

async function cardInfo(pageValue, code) {
  return pageValue.evaluate((selector) => {
    const node = document.querySelector(selector);
    if (!node) return null;
    const presence = [...node.querySelectorAll(".lobby-presence")].map((dot) => dot.className.replace("lobby-presence ", ""));
    return {
      text: node.textContent.replace(/\s+/gu, " ").trim(),
      status: node.querySelector(".lobby-room-status-badge")?.textContent,
      presence,
      actions: [...node.querySelectorAll(".room-card-actions button")].map((button) => button.textContent.trim()),
      note: node.querySelector(".lobby-room-note")?.hidden ? "" : node.querySelector(".lobby-room-note")?.textContent,
    };
  }, card(code));
}

async function createRoom(pageValue, { name, gameType = "go", unlisted = false }) {
  await pageValue.goto(`${BASE}/lobby`);
  await pageValue.waitForTimeout(700);
  await pageValue.click("#lobby-create-room");
  await pageValue.waitForSelector("#online-dialog[open]");
  await pageValue.click(`#online-dialog [data-game-type="${gameType}"]`);
  await pageValue.fill("#player-name", name);
  if (unlisted) await pageValue.check("#room-unlisted");
  await pageValue.click("#create-room");
  await pageValue.waitForURL(/\/online\/[A-Z0-9]{6}/u, { timeout: 20_000 });
  await pageValue.waitForTimeout(1_000);
  return /\/online\/([A-Z0-9]{6})/u.exec(pageValue.url())[1];
}

process.on("uncaughtException", (error) => {
  console.log(JSON.stringify({ failed: error.stack, record, problems }, null, 2));
  process.exit(1);
});

const host = await page("host");
const guest = await page("guest");
const viewer = await page("viewer");
const english = await page("english", "en");

try {
  // 1. A host on their own creates a public Go room.
  const code = await createRoom(host, { name: "房主甲" });
  record.code = code;
  record.hostAlone = { hint: await text(host, "#room-hint"), blackSeat: await text(host, "#black-seat"), whiteSeat: await text(host, "#white-seat") };

  // 2. Another player sees it in the lobby: open seat, host online, counts.
  await guest.goto(`${BASE}/lobby`);
  await untilLobby(guest, (selector) => Boolean(document.querySelector(selector)?.querySelector('[data-lobby-role="player"]')), card(code), { label: "joinable card" });
  record.waitingCard = await cardInfo(guest, code);
  record.counts = {
    stats: await text(guest, "#lobby-stats"),
    joinable: await text(guest, '[data-lobby-count="joinable"]'),
    myRoomsHidden: await guest.locator("#lobby-my-rooms").isHidden(),
  };
  // Search by the host's name and by code; a miss shows the empty state.
  await guest.fill("#lobby-search", "房主甲");
  await guest.waitForTimeout(300);
  const byName = await guest.locator(card(code)).isVisible();
  await guest.fill("#lobby-search", code.toLowerCase());
  await guest.waitForTimeout(300);
  const byCode = await guest.locator(card(code)).isVisible();
  await guest.fill("#lobby-search", "没有这个人");
  await guest.waitForTimeout(300);
  const miss = { empty: await guest.locator("#lobby-empty").isVisible(), create: await guest.locator("#lobby-empty-create").isVisible() };
  // A game filter that does not match hides it; the sort keeps it.
  await guest.fill("#lobby-search", code);
  await guest.selectOption("#lobby-game-filter", "gomoku");
  await guest.waitForTimeout(300);
  const hiddenByGame = await guest.locator(card(code)).isHidden();
  await guest.selectOption("#lobby-game-filter", "go");
  await guest.selectOption("#lobby-sort", "newest");
  await guest.waitForTimeout(300);
  record.search = { byName, byCode, miss, hiddenByGame, afterSort: await guest.locator(card(code)).isVisible() };

  // 3. Quick join (search narrowed to this room) takes White.
  await guest.click("#lobby-quick-join");
  await guest.waitForURL(new RegExp(`/online/${code}`, "u"), { timeout: 10_000 });
  await guest.waitForSelector("#online-dialog[open]");
  await guest.fill("#player-name", "客人乙");
  await guest.click("#join-room");
  await guest.waitForFunction(() => !document.querySelector("#online-dialog")?.open, null, { timeout: 15_000 });
  await host.waitForTimeout(1_000);
  record.quickJoin = { url: guest.url(), whiteSeat: await text(host, "#white-seat"), guestHint: await text(guest, "#room-hint") };

  // 4. The host starts a friend game; the guest accepts.
  await host.click('[data-sidebar-tab="settings"]');
  await host.selectOption("#online-match-mode", "friend");
  await host.click("#confirm-next-game");
  await guest.waitForSelector("#game-invitation-panel:not([hidden])", { timeout: 15_000 });
  await guest.click("#accept-game-invitation");
  await host.waitForTimeout(1_000);
  record.playing = { host: await text(host, "#phase-label"), guest: await text(guest, "#phase-label") };

  // 5. A viewer finds the game in progress and watches.
  await viewer.goto(`${BASE}/lobby`);
  await viewer.fill("#lobby-search", code);
  await untilLobby(viewer, (selector) => /正在进行/u.test(document.querySelector(selector)?.textContent ?? ""), card(code), { label: "playing card" });
  record.playingCard = await cardInfo(viewer, code);
  await viewer.click(`${card(code)} [data-lobby-role="spectator"]`);
  await viewer.waitForSelector("#online-dialog[open]");
  await viewer.fill("#player-name", "观众丙");
  await viewer.click("#watch-room");
  await viewer.waitForFunction(() => !document.querySelector("#online-dialog")?.open, null, { timeout: 15_000 });
  await viewer.waitForTimeout(800);
  record.viewer = { hint: await text(viewer, "#room-hint") };

  // 6. An English lobby: the same room, translated, with one spectator.
  await english.goto(`${BASE}/lobby`);
  await english.fill("#lobby-search", code);
  await untilLobby(english, (selector) => /1 spectator/u.test(document.querySelector(selector)?.textContent ?? ""), card(code), { label: "english spectator count" });
  record.english = {
    card: await cardInfo(english, code),
    stats: await text(english, "#lobby-stats"),
    // Player names are what people typed; everything else must be English.
    leftovers: await englishLeftovers(english),
  };
  record.englishShot = await shot(english, "lobby-english");

  // 7. The guest drops off the network, then comes back.
  await guest.context().setOffline(true);
  await guest.waitForFunction(() => /网络已断开/u.test(document.querySelector("#room-hint")?.textContent ?? ""), null, { timeout: 10_000 });
  const offlineHint = await text(guest, "#room-hint");
  // The room notices a silent socket within about two and a half minutes
  // (90 s without a ping, checked every 60 s during a game) unless the close
  // reached it first.
  await host.waitForFunction(() => /暂时离线/u.test(document.querySelector("#white-seat")?.textContent ?? ""), null, { timeout: 180_000 });
  const hostSeesOffline = await text(host, "#white-seat");
  await untilLobby(english, (selector) => {
    const dots = [...(document.querySelector(selector)?.querySelectorAll(".lobby-presence") ?? [])];
    return dots[1]?.classList.contains("offline") === true;
  }, card(code), { label: "guest offline dot" });
  await guest.context().setOffline(false);
  await guest.waitForFunction(() => !/网络已断开|连接中断|多次重连|正在连接/u.test(document.querySelector("#room-hint")?.textContent ?? ""), null, { timeout: 60_000 });
  await host.waitForFunction(() => / · 在线/u.test(document.querySelector("#white-seat")?.textContent ?? ""), null, { timeout: 30_000 });
  record.reconnect = { offlineHint, hostSeesOffline, backHint: await text(guest, "#room-hint"), hostSeesBack: await text(host, "#white-seat") };

  // 8. The host leaves; the lobby shows them offline; they return from My rooms.
  await host.goto(`${BASE}/lobby`);
  await untilLobby(english, (selector) => {
    const dots = [...(document.querySelector(selector)?.querySelectorAll(".lobby-presence") ?? [])];
    return dots[0]?.classList.contains("offline") === true;
  }, card(code), { label: "host offline dot" });
  record.hostAway = await cardInfo(english, code);
  await host.waitForSelector("#lobby-my-rooms:not([hidden])", { timeout: 10_000 });
  record.myRooms = await host.$$eval("#lobby-my-room-list .lobby-my-room", (items) => items.map((item) => item.textContent.replace(/\s+/gu, " ").trim()));
  record.myRoomsShot = await shot(host, "lobby-my-rooms");
  // The same list in English (player names aside).
  await host.click('[data-language="en"]');
  await host.waitForTimeout(400);
  record.myRoomsEnglish = {
    entry: await text(host, "#lobby-my-room-list .lobby-my-room"),
    leftovers: await englishLeftovers(host),
  };
  await host.click('[data-language="zh-CN"]');
  await host.waitForTimeout(400);
  await host.click(`#lobby-my-room-list [data-lobby-room="${code}"]`);
  await host.waitForURL(new RegExp(`/online/${code}`, "u"), { timeout: 10_000 });
  await host.waitForFunction(() => /轮到你了|等待对方|对方落子|你执黑/u.test(document.querySelector("#room-hint")?.textContent ?? "") ||
    /黑方落子|白方落子/u.test(document.querySelector("#turn-text")?.textContent ?? ""), null, { timeout: 20_000 });
  record.resumed = { url: host.url(), hint: await text(host, "#room-hint"), blackSeat: await text(host, "#black-seat") };

  // 9. Copy a card's link.
  await host.goto(`${BASE}/lobby`);
  await host.fill("#lobby-search", code);
  await untilLobby(host, (selector) => Boolean(document.querySelector(selector)), card(code), { label: "host card" });
  await host.click(`${card(code)} [data-lobby-copy]`);
  await host.waitForTimeout(300);
  record.copied = { clipboard: await host.evaluate(() => navigator.clipboard.readText()), status: await text(host, "#lobby-status") };

  // 10. An unlisted room: not public, but in My rooms; Remove takes two clicks.
  const hidden = await createRoom(host, { name: "房主甲", gameType: "othello", unlisted: true });
  record.unlisted = { code: hidden };
  await guest.goto(`${BASE}/lobby`);
  await guest.fill("#lobby-search", hidden);
  await guest.waitForTimeout(1_500);
  await guest.click("#lobby-refresh");
  await guest.waitForTimeout(1_200);
  record.unlisted.publicCard = await guest.locator(card(hidden)).count();
  await host.goto(`${BASE}/lobby`);
  await host.waitForSelector(`#lobby-my-room-list [data-room-code="${hidden}"]`, { timeout: 10_000 });
  record.unlisted.myRoom = await text(host, `#lobby-my-room-list [data-room-code="${hidden}"]`);
  await host.click(`#lobby-my-room-list [data-lobby-forget="${hidden}"]`);
  record.unlisted.armed = await text(host, `#lobby-my-room-list [data-lobby-forget="${hidden}"]`);
  await host.click(`#lobby-my-room-list [data-lobby-forget="${hidden}"]`);
  await host.waitForTimeout(400);
  record.unlisted.afterRemove = {
    gone: (await host.locator(`#lobby-my-room-list [data-room-code="${hidden}"]`).count()) === 0,
    stillThere: await host.locator(`#lobby-my-room-list [data-room-code="${code}"]`).count(),
    status: await text(host, "#lobby-status"),
  };

  // 11. The host resigns in the first room: the finished game leaves the
  // lobby; the host's My rooms keeps it.
  await host.click(`#lobby-my-room-list [data-lobby-room="${code}"]`);
  await host.waitForURL(new RegExp(`/online/${code}`, "u"));
  await host.waitForSelector("#resign-button:not([hidden])", { timeout: 20_000 });
  await host.click('[data-sidebar-tab="game"]');
  await host.click("#resign-button");
  await host.click("#confirm-resign");
  await host.waitForTimeout(1_200);
  await untilLobby(english, (selector) => !document.querySelector(selector), card(code), { label: "finished game leaves the lobby" });
  await host.goto(`${BASE}/lobby`);
  await host.waitForSelector(`#lobby-my-room-list [data-room-code="${code}"]`, { timeout: 10_000 });
  record.finished = {
    publicCard: await english.locator(card(code)).count(),
    myRoom: await text(host, `#lobby-my-room-list [data-room-code="${code}"]`),
    statusTabs: await english.$$eval("[data-lobby-status]", (buttons) => buttons.map((button) => button.dataset.lobbyStatus)),
  };
} catch (error) {
  record.error = error.stack;
  record.failShots = [await shot(host, "lobby-fail-host"), await shot(guest, "lobby-fail-guest"), await shot(english, "lobby-fail-english")];
}
await browser.close();

// Reconnect attempts while the guest is offline fail in the browser console;
// that is the point of the test, not a problem.
const unexpected = problems.filter((problem) => !/^\[guest\] console\.error: WebSocket connection .*ERR_INTERNET_DISCONNECTED/u.test(problem));
const ok = !record.error &&
  record.waitingCard?.actions.includes("加入对局") && record.waitingCard?.presence[0] === "online" &&
  /可加入 [1-9]/u.test(record.counts?.stats ?? "") && record.counts?.myRoomsHidden &&
  record.search?.byName && record.search?.byCode && record.search?.miss.empty && record.search?.miss.create &&
  record.search?.hiddenByGame && record.search?.afterSort &&
  /客人乙/u.test(record.quickJoin?.whiteSeat ?? "") &&
  record.playingCard?.presence.join() === "online,online" &&
  record.english?.leftovers.length === 0 && /watching/u.test(record.english?.stats ?? "") &&
  /暂时离线/u.test(record.reconnect?.hostSeesOffline ?? "") && /在线/u.test(record.reconnect?.hostSeesBack ?? "") &&
  record.hostAway?.presence[0] === "offline" &&
  record.myRooms?.some((entry) => entry.includes(record.code) && /你执黑/u.test(entry)) &&
  /You play Black/u.test(record.myRoomsEnglish?.entry ?? "") && record.myRoomsEnglish?.leftovers.length === 0 &&
  new RegExp(`/online/${record.code}`, "u").test(record.resumed?.url ?? "") &&
  record.copied?.clipboard === `${BASE}/online/${record.code}` &&
  record.unlisted?.publicCard === 0 && /不在大厅/u.test(record.unlisted?.myRoom ?? "") &&
  record.unlisted?.armed === "确认移除" && record.unlisted?.afterRemove.gone && record.unlisted?.afterRemove.stillThere === 1 &&
  record.finished?.publicCard === 0 && /不在大厅/u.test(record.finished?.myRoom ?? "") &&
  record.finished?.statusTabs.join() === "all,joinable,playing";
console.log(JSON.stringify({ ok, record, problems: unexpected }, null, 2));
process.exitCode = ok && unexpected.length === 0 ? 0 : 1;
