// iPhone-sized WebKit pass (the closest stand-in for iOS Safari without a
// device): the app loads without errors, taps place stones, Gomoku (Rapfi
// wasm) and Othello AI replies arrive, 3D views get a WebGL context, and the
// views that move up and down keep vertical drags unless swipes are handed
// to the page.
//   npx playwright install webkit   (once)
import { webkit, devices } from "playwright";
import { BASE, SHOTS } from "./lib.mjs";

const problems = [];
const results = {};
// WebKit gives every <select> an internal shadow tree with inline styles and
// reports it against the page CSP (style-src-attr, at the select's line in
// the HTML). Nothing of ours is blocked; those reports alone are ignored.
const html = (await (await fetch(`${BASE}/single`)).text()).split("\n");
const selectLines = new Set(html.flatMap((line, index) => (/<select\b/u.test(line) ? [index + 1] : [])));
results.ignoredSelectReports = 0;
const browser = await webkit.launch();
const context = await browser.newContext({ ...devices["iPhone 13"] });
await context.addInitScript(() => {
  try { localStorage.setItem("3d-baduk-locale-v1", "zh-CN"); } catch {}
  document.addEventListener("securitypolicyviolation", (event) => {
    console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI} @${event.sourceFile}:${event.lineNumber}`);
  });
});
const page = await context.newPage();
page.on("console", (message) => {
  if (message.type() !== "error") return;
  const text = message.text();
  const violation = /^CSP violation: style-src-attr inline @:(\d+)$/u.exec(text);
  if (violation && selectLines.has(Number(violation[1]))) {
    results.ignoredSelectReports += 1;
    return;
  }
  if (capturing && /^CSP violation: style-src-elem inline/u.test(text)) return;
  // The console line WebKit prints for the same select reports.
  if (/^Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline'/u.test(text)) return;
  problems.push(`console.error: ${text}`);
});
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

const text = async (selector) => ((await page.locator(selector).first().textContent()) ?? "").trim();
const moveNumber = () => text("#move-number");
const moveIndex = (value) => Number(/第 (\d+) 手/u.exec(value)?.[1] ?? NaN);
// Playwright WebKit injects a style while it captures a screenshot, which
// the page CSP reports (style-src-elem); ignore reports during a capture.
let capturing = false;
const shot = async (name) => {
  if (process.env.NO_SHOTS) return;
  capturing = true;
  await page.screenshot({ path: `${SHOTS}/webkit-${name}.png` });
  await page.waitForTimeout(200);
  capturing = false;
};

async function tapBoardCentre() {
  const canvas = page.locator(".view-surface:not([hidden]) canvas").first();
  const box = await canvas.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(400);
}

async function configure(gameType, topology) {
  await page.click('[data-sidebar-tab="settings"]');
  await page.click(`#game-type-field [data-game-type="${gameType}"]`);
  await page.click(`.settings [data-board-topology="${topology}"]`);
  await page.waitForTimeout(300);
}

async function startAI(level = "easy") {
  await page.click("[data-open-invite]");
  await page.waitForSelector("#invite-dialog[open]");
  await page.click("#invite-ai");
  await page.waitForSelector("#ai-dialog[open]");
  await page.selectOption("#ai-level", level);
  await page.click("#start-ai");
  await page.waitForTimeout(500);
}

await page.goto(`${BASE}/single`);
await page.waitForTimeout(1_500);
results.title = await page.title();
results.webgl = await page.evaluate(() => Boolean(document.createElement("canvas").getContext("webgl2") ??
  document.createElement("canvas").getContext("webgl")));
results.wasmSimd = await page.evaluate(() => WebAssembly.validate(new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
])));

// Go: a local game, one tap in the flat view places a stone.
await page.click('.view-switch [data-view-mode="flat"]');
await page.click("[data-open-invite]");
await page.waitForSelector("#invite-dialog[open]");
await page.click("#invite-local");
await page.waitForTimeout(500);
const beforeTap = await moveNumber();
await tapBoardCentre();
results.goTap = { before: beforeTap, after: await moveNumber() };
await shot("go-tap");

// Gomoku vs Rapfi on the torus, then Othello vs our engine on the Möbius strip.
for (const [gameType, topology] of [["gomoku", "torus"], ["othello", "mobius"]]) {
  await page.goto(`${BASE}/single`);
  await page.waitForTimeout(1_000);
  await configure(gameType, topology);
  await page.click('.view-switch [data-view-mode="flat"]');
  await startAI();
  const before = await moveNumber();
  // Tap until a human move lands, then wait for the AI's reply.
  const canvas = page.locator(".view-surface:not([hidden]) canvas").first();
  const box = await canvas.boundingBox();
  const points = gameType === "othello"
    ? [[0.44, 0.31], [0.31, 0.44], [0.56, 0.69], [0.69, 0.56], [0.5, 0.31], [0.31, 0.5]]
    : [[0.5, 0.5]];
  for (const [fx, fy] of points) {
    await page.touchscreen.tap(box.x + box.width * fx, box.y + box.height * fy);
    await page.waitForTimeout(500);
    if ((await moveNumber()) !== before) break;
  }
  const afterHuman = await moveNumber();
  // The human move and the AI reply: two moves on from the start.
  let reply = "";
  try {
    await page.waitForFunction((start) => {
      const now = Number(/第 (\d+) 手/u.exec(document.querySelector("#move-number")?.textContent ?? "")?.[1]);
      return now >= start + 2 && /轮到你|Your/u.test(document.querySelector("#ai-hint")?.textContent ?? "");
    }, moveIndex(before), { timeout: 30_000 });
    reply = await moveNumber();
  } catch {
    reply = `timeout (${await text("#ai-hint")})`;
  }
  results[gameType] = { before, afterHuman, afterAI: reply, message: await text("#message") };
  await shot(`${gameType}-ai`);
}

// Boards that move up and down (the flat torus, every 3D view) keep
// vertical drags; sideways-only views (the arc) leave them to the page. The
// toolbar can hand vertical swipes to the page on the others too.
const touchAction = () => page.evaluate(() => {
  const canvas = [...document.querySelectorAll(".view-surface:not([hidden]) canvas")][0];
  return canvas ? getComputedStyle(canvas).touchAction : null;
});
const viewState = async (view) => {
  await page.click(`.view-switch [data-view-mode="${view}"]`);
  await page.waitForTimeout(600);
  return {
    toggleVisible: await page.locator("#toggle-page-scroll").isVisible(),
    touchAction: await touchAction(),
    hint: await text("#gesture-primary"),
  };
};
results.scroll = {};
await page.goto(`${BASE}/single`);
await page.waitForTimeout(1_000);
results.scroll.cylinderArc = await viewState("arc");
results.scroll.cylinder3d = await viewState("3d");
await configure("go", "torus");
results.scroll.torusFlat = await viewState("flat");
results.scroll.torus3d = await viewState("3d");
await page.click("#toggle-page-scroll");
await page.waitForTimeout(300);
results.scroll.swipeScrolls = {
  touchAction: await touchAction(),
  pressed: await page.getAttribute("#toggle-page-scroll", "aria-pressed"),
  hint: await text("#gesture-primary"),
};
results.scroll.swipeScrollsFlat = (await viewState("flat")).touchAction;
await page.click("#toggle-page-scroll");
await page.waitForTimeout(300);
results.scroll.backToBoard = await touchAction();
await shot("torus-3d");

await browser.close();
const ok = results.goTap.before !== results.goTap.after &&
  results.gomoku.afterAI && !results.gomoku.afterAI.startsWith("timeout") &&
  results.othello.afterAI && !results.othello.afterAI.startsWith("timeout") &&
  results.scroll.cylinderArc.touchAction === "pan-y" && !results.scroll.cylinderArc.toggleVisible &&
  results.scroll.cylinder3d.touchAction === "none" &&
  results.scroll.torusFlat.touchAction === "none" && results.scroll.torusFlat.toggleVisible &&
  results.scroll.torus3d.touchAction === "none" &&
  results.scroll.swipeScrolls.touchAction === "pan-y" && results.scroll.swipeScrolls.pressed === "true" &&
  results.scroll.swipeScrollsFlat === "pan-y" && results.scroll.backToBoard === "none";
console.log(JSON.stringify({ ok, results, problems }, null, 2));
process.exitCode = ok && problems.length === 0 ? 0 : 1;
