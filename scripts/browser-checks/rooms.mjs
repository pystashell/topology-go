// Room management: an unlisted Gomoku room (kept out of the lobby, then
// listed and unlisted again), the host removing a spectator, the guest
// playing White against the host's AI (with undo), and the host claiming
// the game once the guest has been offline for two minutes. Ends with an
// English pass over the host's room panel. Takes about three minutes.
import { BASE, cjkLeftovers, launch, openPage, problems, scanBoard, setView, shot, text } from "./lib.mjs";
import { installCspWatch, log, moveCount } from "./play.mjs";

const browser = await launch();
const record = { tag: "rooms" };

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

async function lobbyCodes() {
  const response = await fetch(`${BASE}/api/lobby`);
  const body = await response.json();
  return (body.rooms ?? []).map((room) => room.code);
}

async function join(pageValue, code, { name, role }) {
  await pageValue.goto(`${BASE}/online/${code}?role=${role}`);
  await pageValue.waitForSelector("#online-dialog[open]");
  await pageValue.fill("#player-name", name);
  await pageValue.click(role === "spectator" ? "#watch-room" : "#join-room");
  await pageValue.waitForFunction(() => !document.querySelector("#online-dialog")?.open, null, { timeout: 15_000 });
  await pageValue.waitForTimeout(800);
}

async function memberRows(host) {
  return host.$$eval("#room-member-list li", (items) => items.map((item) => item.textContent.replace(/\s+/gu, " ").trim()));
}

process.on("uncaughtException", (error) => {
  console.log(JSON.stringify({ failed: error.message, record, problems }, null, 2));
  process.exit(1);
});

const host = await page("host");
const guest = await page("guest");
const viewer = await page("viewer");

// 1. An unlisted room.
await host.goto(`${BASE}/lobby`);
await host.waitForTimeout(800);
await host.click("#lobby-create-room");
await host.waitForSelector("#online-dialog[open]");
await host.click('#online-dialog [data-game-type="gomoku"]');
await host.fill("#player-name", "Host");
await host.check("#room-unlisted");
await host.click("#create-room");
await host.waitForURL(/\/online\/[A-Z0-9]{6}/u, { timeout: 20_000 });
await host.waitForTimeout(1_000);
const code = /\/online\/([A-Z0-9]{6})/u.exec(host.url())[1];
record.code = code;
record.unlisted = {
  badge: await host.locator("#room-unlisted-badge").isVisible(),
  toggleChecked: await host.isChecked("#room-listed"),
  inLobby: (await lobbyCodes()).includes(code),
};

// 2. A guest takes White and a viewer watches.
await join(guest, code, { name: "Guest", role: "player" });
await join(viewer, code, { name: "Viewer", role: "spectator" });
await host.waitForTimeout(800);
record.members = await memberRows(host);

// 3. Listing toggles the lobby entry.
await host.click("#room-listed");
await host.waitForTimeout(1_500);
const listedNow = (await lobbyCodes()).includes(code);
await host.click("#room-listed");
await host.waitForTimeout(1_500);
record.listing = { listedNow, unlistedAgain: !(await lobbyCodes()).includes(code), message: await text(host, "#message") };

// 4. The host removes the viewer.
await host.click('#room-member-list [data-remove-member]:not([disabled]) >> nth=1');
await viewer.waitForTimeout(1_500);
record.removed = {
  members: await memberRows(host),
  viewerMessage: await text(viewer, "#message"),
  viewerError: await text(viewer, "#online-error"),
  viewerUrl: viewer.url(),
  viewerShot: await shot(viewer, "rooms-viewer-removed"),
};

// 5. The guest plays White against the host's AI.
await host.click('[data-sidebar-tab="settings"]');
await host.selectOption("#online-match-mode", "guest-ai");
await host.selectOption("#online-match-black-ai-level", "easy");
await host.waitForTimeout(300);
record.guestAISetup = {
  blackLevelVisible: await host.locator("#online-match-black-ai-level-field").isVisible(),
  whiteLevelVisible: await host.locator("#online-match-ai-level-field").isVisible(),
  note: await text(host, "#online-match-black-ai-level-note"),
};
await host.click("#confirm-next-game");
await guest.waitForSelector("#game-invitation-panel:not([hidden])", { timeout: 15_000 });
record.invitation = {
  title: await text(guest, "#game-invitation-title"),
  summary: await text(guest, "#game-invitation-summary"),
};
await guest.click("#accept-game-invitation");
// The host's AI opens as Black.
await guest.waitForFunction(() => /第 2 手/u.test(document.querySelector("#move-number")?.textContent ?? ""), null, { timeout: 30_000 });
await guest.click('[data-sidebar-tab="game"]');
await setView(guest, "flat");
const map = await scanBoard(guest, { step: 5 });
for (let round = 0; round < 2; round += 1) {
  await guest.waitForFunction(() => /轮到你了/u.test(document.querySelector("#room-hint")?.textContent ?? ""), null, { timeout: 30_000 });
  const before = await moveCount(guest);
  for (const point of Object.values(map).sort(() => Math.random() - 0.5)) {
    await guest.mouse.click(point.x, point.y);
    await guest.waitForTimeout(400);
    if ((await moveCount(guest)) > before) break;
  }
}
await guest.waitForFunction(() => /轮到你了/u.test(document.querySelector("#room-hint")?.textContent ?? ""), null, { timeout: 30_000 });
const beforeUndo = await moveCount(guest);
await guest.click("#undo-button");
await guest.waitForTimeout(1_500);
record.guestAI = {
  seats: [await text(host, "#black-seat"), await text(host, "#white-seat")],
  mode: await text(host, "#room-mode"),
  beforeUndo,
  afterUndo: await moveCount(guest),
  guestShot: await shot(guest, "rooms-guest-ai"),
};

// 6. The guest goes away; after two minutes the host claims the game.
await guest.context().close();
await host.click('[data-sidebar-tab="game"]');
await host.waitForSelector("#abandonment-panel:not([hidden])", { timeout: 20_000 });
record.abandonment = {
  title: await text(host, "#abandonment-title"),
  noteEarly: await text(host, "#abandonment-note"),
  disabledEarly: await host.isDisabled("#claim-abandonment"),
};
await host.waitForFunction(() => !document.querySelector("#claim-abandonment")?.disabled, null, { timeout: 150_000 });
record.abandonment.noteReady = await text(host, "#abandonment-note");
await host.click("#claim-abandonment");
await host.waitForFunction(() => /对局结束|认输终局/u.test(document.querySelector("#phase-label")?.textContent ?? ""), null, { timeout: 15_000 });
record.abandonment.result = await text(host, "#turn-text");
record.abandonment.panelHidden = await host.locator("#abandonment-panel").isHidden();
record.hostShot = await shot(host, "rooms-host-claimed");

// 7. English pass over the host's room panel.
await host.click('[data-language="en"]');
await host.waitForTimeout(500);
await host.click('[data-sidebar-tab="game"]');
record.english = {
  manage: (await host.$$eval("#room-manage-panel", (nodes) => nodes.map((node) => node.textContent.replace(/\s+/gu, " ").trim())))[0],
  leftovers: await cjkLeftovers(host),
};

record.ok = record.unlisted.badge && !record.unlisted.toggleChecked && !record.unlisted.inLobby &&
  record.members.length === 2 &&
  record.listing.listedNow && record.listing.unlistedAgain &&
  record.removed.members.length === 1 &&
  record.guestAISetup.blackLevelVisible && !record.guestAISetup.whiteLevelVisible &&
  /执白对战 AI/u.test(record.invitation.title) &&
  record.guestAI.afterUndo === record.guestAI.beforeUndo - 2 &&
  record.abandonment.disabledEarly && /胜/u.test(record.abandonment.result) &&
  record.english.leftovers.length === 0;
log("rooms", record.ok);
await browser.close();
console.log(JSON.stringify({ record, problems }, null, 2));
process.exitCode = record.ok && problems.length === 0 ? 0 : 1;
