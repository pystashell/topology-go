// The Othello flip wave in the page, frame by frame: a local 8x8 cylinder
// game reaches a move whose discs lie at distances 1, 2 and 3 from the new
// disc. Each disc's centre and side are sampled on the flat canvas every
// frame: it must stay white (the old colour) until its ring's turn, narrow
// to its edge (the side shows the board), and end black, the rings one after
// another in order of distance. Undo then shows the earlier position at
// once, without a wave.
import { BASE, clickPoint, configureBoard, launch, openPage, problems, scanBoard, setView, shot, startLocalGame, text } from "./lib.mjs";

// Black's fifth move (4,7) flips (4,6), (4,5) and (4,4): distances 1, 2, 3.
const LINE = [[4, 5], [5, 5], [6, 5], [4, 6]];
const LAST = [4, 7];
const RINGS = [[4, 6], [4, 5], [4, 4]];

const browser = await launch();
const { page } = await openPage(browser, { name: "flip-wave" });
const record = {};
try {
  await page.goto(`${BASE}/single`);
  await page.waitForTimeout(800);
  await configureBoard(page, { gameType: "othello", topology: "cylinder", width: 8, height: 8 });
  await startLocalGame(page);
  await setView(page, "flat");
  await page.click('[data-sidebar-tab="game"]');
  const map = await scanBoard(page, { step: 4 });
  for (const [row, col] of LINE) {
    const before = await text(page, "#move-number");
    await clickPoint(page, map, row, col, 8);
    await page.waitForFunction((value) => document.querySelector("#move-number")?.textContent !== value, before);
  }
  await page.waitForTimeout(1_500);
  const labels = RINGS.map(([row, col]) => `${"ABCDEFGH"[col]}${8 - row}`);
  const centres = labels.map((label) => ({ x: map[label].cx, y: map[label].cy }));
  // Disc radius on screen: 0.41 of a cell; cells are the label spacing.
  const cell = Math.abs(map.B1.x - map.A1.x);
  // Sample from the next frames on, then play the move.
  const sampling = page.evaluate(({ points, side }) => new Promise((resolve) => {
    const canvas = [...document.querySelectorAll(".view-surface")].find((node) => !node.hidden).querySelector("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const lum = (x, y) => {
      const [r, g, b] = context.getImageData(Math.round((x - rect.left) * scale), Math.round((y - rect.top) * scale), 1, 1).data;
      return { lum: Math.round(0.3 * r + 0.59 * g + 0.11 * b), green: g > r + 30 && g > b + 10 };
    };
    const frames = [];
    let started = null;
    const step = (now) => {
      started ??= now;
      frames.push({
        t: Math.round(now - started),
        discs: points.map(({ x, y }) => ({ centre: lum(x, y), side: lum(x + side, y) })),
      });
      if (now - started < 4_000) requestAnimationFrame(step);
      else resolve(frames);
    };
    requestAnimationFrame(step);
  }), { points: centres, side: cell * 0.41 * 0.75 });
  await clickPoint(page, map, LAST[0], LAST[1], 8);
  const frames = await sampling;
  // When each disc first shows black at its centre, and whether its side
  // showed the board (narrowed) on the way.
  record.rings = labels.map((label, index) => {
    const turnedAt = frames.find((frame, i) => i > 0 && frame.discs[index].centre.lum < 90)?.t ?? null;
    const whiteUntil = [...frames].reverse().find((frame) => frame.discs[index].centre.lum > 170)?.t ?? null;
    const narrowed = frames.some((frame) => frame.discs[index].side.green);
    return { label, whiteUntil, turnedAt, narrowed };
  });
  record.message = await text(page, "#message");
  record.shot = await shot(page, "flip-wave-final");
  const [first, second, third] = record.rings;
  record.inOrder = first.turnedAt !== null && second.turnedAt > first.turnedAt + 100 && third.turnedAt > second.turnedAt + 100;
  record.visible = record.rings.every((ring) => ring.narrowed && ring.whiteUntil !== null && ring.whiteUntil >= 150);
  // Undo: the earlier position at once, no wave.
  await page.click("#undo-button");
  await page.waitForTimeout(80);
  record.afterUndo = await page.evaluate((points) => {
    const canvas = [...document.querySelectorAll(".view-surface")].find((node) => !node.hidden).querySelector("canvas");
    const context = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    return points.map(({ x, y }) => {
      const [r, g, b] = context.getImageData(Math.round((x - rect.left) * scale), Math.round((y - rect.top) * scale), 1, 1).data;
      return Math.round(0.3 * r + 0.59 * g + 0.11 * b);
    });
  }, centres);
  record.undoInstant = record.afterUndo.every((value) => value > 170);
  // The same move in each 3D view: the stones turn without errors and the
  // position settles with the discs black.
  record.views3d = {};
  for (const view of ["3d", "arc"]) {
    await setView(page, view);
    const map3d = await scanBoard(page, { step: 5 });
    const before = await text(page, "#move-number");
    await clickPoint(page, map3d, LAST[0], LAST[1], 8);
    await page.waitForFunction((value) => document.querySelector("#move-number")?.textContent !== value, before);
    await page.waitForTimeout(350);
    const midShot = await shot(page, `flip-wave-${view}`);
    await page.waitForTimeout(2_000);
    record.views3d[view] = { message: await text(page, "#message"), midShot, after: await shot(page, `flip-wave-${view}-done`) };
    await page.click("#undo-button");
    await page.waitForTimeout(300);
  }
} catch (error) {
  record.error = error.stack;
}
await browser.close();
record.ok = Boolean(record.inOrder && record.visible && record.undoInstant && /翻转 3 子/u.test(record.message ?? "") &&
  Object.values(record.views3d ?? {}).length === 2 &&
  Object.values(record.views3d).every((entry) => /翻转 3 子/u.test(entry.message)));
console.log(JSON.stringify({ record, problems }, null, 2));
process.exitCode = record.ok && problems.length === 0 ? 0 : 1;
