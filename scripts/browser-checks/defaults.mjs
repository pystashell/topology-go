// A browser that never chose a board starts each game on its smallest quick
// size: Go 9 x 9, Gomoku 7 x 7, Othello 6 x 6 (owner's decision). A few
// seconds.
import { BASE, launch, openPage, problems } from "./lib.mjs";

const browser = await launch();
const { page } = await openPage(browser, { name: "fresh" });
const result = {};
try {
  await page.goto(`${BASE}/single`);
  await page.waitForTimeout(1_500);
  const read = () => page.evaluate(() => ({
    width: document.querySelector("#custom-width")?.value,
    height: document.querySelector("#custom-height")?.value,
    active: document.querySelector("[data-board-size].active:not([hidden])")?.textContent?.trim(),
    dimensions: document.querySelector("#board-dimensions, .board-dimensions")?.textContent?.trim() ?? null,
  }));
  result.go = await read();
  await page.click('[data-sidebar-tab="settings"]');
  for (const gameType of ["gomoku", "othello", "go"]) {
    await page.click(`#game-type-field [data-game-type="${gameType}"]`);
    await page.waitForTimeout(300);
    result[`${gameType}Picked`] = await read();
  }
} catch (error) {
  result.error = error.stack;
}
await browser.close();

const is = (entry, side) => entry?.width === String(side) && entry?.height === String(side) && entry?.active === `${side} × ${side}`;
const ok = !result.error && is(result.go, 9) && is(result.gomokuPicked, 7) && is(result.othelloPicked, 6) && is(result.goPicked, 9);
console.log(JSON.stringify({ ok, result, problems }, null, 2));
process.exitCode = ok && problems.length === 0 ? 0 : 1;
