// Real touch input on a phone profile (Chromium, through CDP, so the
// browser's own touch-action and scrolling decide where a swipe goes):
// up/down drags move the flat torus and every 3D view without scrolling the
// page, a vertical swipe on the arc scrolls the page, and the "swipe scrolls
// page" toolbar choice hands vertical swipes on the torus to the page.
import { devices } from "playwright";
import { BASE, launch, problems, SHOTS } from "./lib.mjs";

const browser = await launch();
const context = await browser.newContext({ ...devices["Pixel 7"] });
await context.addInitScript(() => {
  try {
    localStorage.setItem("3d-baduk-locale-v1", "zh-CN");
    localStorage.removeItem("topology-go-board-swipe-scrolls-page-v1");
  } catch {}
});
const page = await context.newPage();
page.on("console", (message) => {
  if (message.type() === "error") problems.push(`console.error: ${message.text()}`);
});
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
const cdp = await context.newCDPSession(page);

async function canvasBox() {
  const canvas = page.locator(".view-surface:not([hidden]) canvas").first();
  await canvas.scrollIntoViewIfNeeded();
  return canvas.boundingBox();
}

/** A one-finger vertical swipe from the canvas centre, upwards by `distance`. */
async function swipeUp(distance = 160) {
  const box = await canvasBox();
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height * 0.7);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let step = 1; step <= 12; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: Math.round(y - (distance * step) / 12) }],
    });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(500);
}

async function boardPixels() {
  const box = await canvasBox();
  return page.screenshot({ clip: box });
}

/** Swipe up on the board: did the board change, did the page scroll? */
async function trySwipe(label) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  const before = await boardPixels();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await swipeUp();
  const after = await boardPixels();
  const scrollAfter = await page.evaluate(() => window.scrollY);
  await page.screenshot({ path: `${SHOTS}/touch-${label}.png` });
  return {
    touchAction: await page.evaluate(() =>
      getComputedStyle(document.querySelector(".view-surface:not([hidden]) canvas")).touchAction),
    boardMoved: !before.equals(after),
    pageScrolled: scrollAfter !== scrollBefore,
  };
}

async function show(view) {
  await page.click(`.view-switch [data-view-mode="${view}"]`);
  await page.waitForTimeout(700);
}

const results = {};
await page.goto(`${BASE}/single`);
await page.waitForTimeout(1_500);
// Turn auto-rotation off so only the swipe can change the picture.
await show("arc");
results.arc = await trySwipe("arc");
await show("3d");
results.cylinder3d = await trySwipe("cylinder-3d");

await page.click('[data-sidebar-tab="settings"]');
await page.click('.settings [data-board-topology="torus"]');
await page.waitForTimeout(500);
await show("flat");
results.torusFlat = await trySwipe("torus-flat");
await show("3d");
results.torus3d = await trySwipe("torus-3d");

// Hand vertical swipes to the page.
await page.click("#toggle-page-scroll");
await page.waitForTimeout(300);
results.torus3dSwipeScrolls = await trySwipe("torus-3d-swipe-scrolls");
await page.click("#toggle-page-scroll");

await browser.close();
const moves = (entry) => entry.touchAction === "none" && entry.boardMoved && !entry.pageScrolled;
const ok = results.arc.touchAction === "pan-y" && results.arc.pageScrolled &&
  moves(results.cylinder3d) && moves(results.torusFlat) && moves(results.torus3d) &&
  results.torus3dSwipeScrolls.touchAction === "pan-y" && results.torus3dSwipeScrolls.pageScrolled;
console.log(JSON.stringify({ ok, results, problems }, null, 2));
process.exitCode = ok && problems.length === 0 ? 0 : 1;
