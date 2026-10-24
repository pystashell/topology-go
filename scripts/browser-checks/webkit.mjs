// iPhone-sized WebKit pass (the closest stand-in for iOS Safari without a
// device): the app loads without errors, taps place stones, Gomoku (Rapfi
// wasm) and Othello AI replies arrive, 3D views get a WebGL context, and the
// torus views let vertical swipes scroll the page until the page is fixed.
//   npx playwright install webkit   (once)
import { webkit, devices } from "playwright";
import { BASE, SHOTS } from "./lib.mjs";

const problems = [];
const results = {};
const browser = await webkit.launch();
const context = await browser.newContext({ ...devices["iPhone 13"] });
await context.addInitScript(() => {
  try { localStorage.setItem("3d-baduk-locale-v1", "zh-CN"); } catch {}
  document.addEventListener("securitypolicyviolation", (event) => {
    console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
  });
});
const page = await context.newPage();
page.on("console", (message) => {
  if (message.type() === "error") problems.push(`console.error: ${message.text()}`);
});
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

const text = async (selector) => ((await page.locator(selector).first().textContent()) ?? "").trim();
const moveNumber = () => text("#move-number");
const shot = (name) => page.screenshot({ path: `${SHOTS}/webkit-${name}.png` });

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
  let reply = "";
  try {
    await page.waitForFunction((value) => {
      const now = document.querySelector("#move-number")?.textContent ?? "";
      return now !== value && /轮到你|Your/u.test(document.querySelector("#ai-hint")?.textContent ?? "");
    }, afterHuman, { timeout: 30_000 });
    reply = await moveNumber();
  } catch {
    reply = `timeout (${await text("#ai-hint")})`;
  }
  results[gameType] = { before, afterHuman, afterAI: reply, message: await text("#message") };
  await shot(`${gameType}-ai`);
}

// Torus views: vertical swipes scroll the page unless the page is fixed.
await page.goto(`${BASE}/single`);
await page.waitForTimeout(1_000);
await configure("go", "torus");
const touchAction = () => page.evaluate(() => {
  const canvas = [...document.querySelectorAll(".view-surface:not([hidden]) canvas")][0];
  return canvas ? getComputedStyle(canvas).touchAction : null;
});
results.scroll = {};
for (const view of ["flat", "3d"]) {
  await page.click(`.view-switch [data-view-mode="${view}"]`);
  await page.waitForTimeout(600);
  results.scroll[view] = {
    toggleVisible: await page.locator("#toggle-page-scroll").isVisible(),
    default: await touchAction(),
    hint: await text("#gesture-primary"),
  };
}
await page.click("#toggle-page-scroll");
await page.waitForTimeout(300);
results.scroll.locked = { touchAction: await touchAction(), pressed: await page.getAttribute("#toggle-page-scroll", "aria-pressed") };
await page.click('.view-switch [data-view-mode="flat"]');
await page.waitForTimeout(400);
results.scroll.lockedFlat = await touchAction();
await page.click("#toggle-page-scroll");
await shot("torus-3d");

await browser.close();
const ok = results.goTap.before !== results.goTap.after &&
  results.gomoku.afterAI && !results.gomoku.afterAI.startsWith("timeout") &&
  results.othello.afterAI && !results.othello.afterAI.startsWith("timeout") &&
  results.scroll.flat.default === "pan-y" && results.scroll["3d"].default === "pan-y" &&
  results.scroll.flat.toggleVisible && results.scroll.locked.touchAction === "none" &&
  results.scroll.lockedFlat === "none";
console.log(JSON.stringify({ ok, results, problems }, null, 2));
process.exitCode = ok && problems.length === 0 ? 0 : 1;
