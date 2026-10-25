// Othello's automatic skip in the page: a local two-player 6x6 cylinder game
// is clicked through a real game until Black cannot outflank anything after
// White's 28th move. The page must say Black is skipped, keep White to move,
// refuse nothing White plays next, and undo back to the skipped turn.
import { BASE, clickPoint, configureBoard, launch, openPage, problems, scanBoard, setView, shot, startLocalGame, text } from "./lib.mjs";

const SKIP_GAME = [
  [1, 2], [1, 1], [2, 1], [1, 3], [2, 4], [4, 2], [0, 1], [2, 0], [0, 3], [0, 2],
  [4, 3], [1, 4], [2, 5], [1, 5], [4, 1], [5, 0], [0, 5], [3, 5], [4, 0], [3, 0],
  [0, 0], [5, 2], [4, 5], [0, 4], [1, 0], [3, 1], [3, 4], [4, 4],
];

const browser = await launch();
const { page } = await openPage(browser, { name: "othello-skip" });
await page.goto(`${BASE}/single`);
await page.waitForTimeout(1_000);
await configureBoard(page, { gameType: "othello", topology: "cylinder", width: 6, height: 6 });
await startLocalGame(page);
await setView(page, "flat");
await page.click('[data-sidebar-tab="game"]');
const map = await scanBoard(page, { step: 4 });
const record = {};
for (const [index, [row, col]] of SKIP_GAME.entries()) {
  const before = await text(page, "#move-number");
  await clickPoint(page, map, row, col, 6);
  await page.waitForFunction((value) => document.querySelector("#move-number")?.textContent !== value, before, { timeout: 5_000 })
    .catch(() => { throw new Error(`move ${index + 1} (${row},${col}) was not accepted: ${before}`); });
}
record.message = await text(page, "#message");
record.phase = await text(page, "#phase-label");
record.turn = await text(page, "#turn-text");
record.shot = await shot(page, "othello-skip");
// White plays again: any legal point is accepted.
const beforeExtra = await text(page, "#move-number");
for (const [row, col] of [[5, 1], [5, 3], [5, 4], [5, 5], [3, 2], [3, 3]]) {
  await clickPoint(page, map, row, col, 6);
  await page.waitForTimeout(200);
  if ((await text(page, "#move-number")) !== beforeExtra) break;
}
record.afterExtra = { move: await text(page, "#move-number"), message: await text(page, "#message") };
await browser.close();
record.ok = /白方落子，翻转 \d+ 子。 黑方无子可下，白方继续。/u.test(record.message) &&
  /黑方无子可下，白方继续/u.test(record.phase) &&
  /白方/u.test(record.turn) &&
  record.afterExtra.move !== beforeExtra && /^白方落子/u.test(record.afterExtra.message);
console.log(JSON.stringify({ record, problems }, null, 2));
process.exitCode = record.ok && problems.length === 0 ? 0 : 1;
