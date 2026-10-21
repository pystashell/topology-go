// Local Gomoku/Othello AI matrix: human vs AI (freestyle, Renju with the AI
// as Black, Othello on every topology), AI self-play with pause/undo/resume,
// direct undo against the AI, and an English pass for leftover Chinese.
import { launch, openPage, problems, shot, text, cjkLeftovers } from "./lib.mjs";
import { finished, installCspWatch, log, moveCount, playAnyLegal, playHumanVsAI, startLocalAIGame } from "./play.mjs";
import { scanBoard, setView } from "./lib.mjs";

const browser = await launch();
const results = [];

async function page(name, locale = "zh-CN") {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript((value) => {
    try { localStorage.setItem("3d-baduk-locale-v1", value); } catch {}
  }, locale);
  await installCspWatch(context);
  return openPage(browser, { context, name, locale });
}

async function humanVsAI({ gameType, ruleSet, topology, width, height, level, humanColor = "black", undo = false }) {
  const tag = `local-${gameType}-${ruleSet ?? "std"}-${topology}-${level}-human-${humanColor}`;
  const { page: p, context } = await page(tag);
  const record = { tag };
  const started = await startLocalAIGame(p, { gameType, ruleSet, topology, width, height, level, humanColor });
  record.dialog = started.dialog;
  record.opponent = await text(p, ".ai-opponent-name");
  record.badge = await text(p, "#ai-level-badge");
  if (undo) {
    // Two rounds, then undo the last human move and the AI reply directly.
    await setView(p, "flat");
    const map = await scanBoard(p, { step: 5 });
    for (let round = 0; round < 2; round += 1) {
      await p.waitForFunction(() => /轮到你落子/u.test(document.querySelector("#turn-text")?.textContent ?? ""), null, { timeout: 15_000 });
      await playAnyLegal(p, map);
    }
    await p.waitForFunction(() => /轮到你落子/u.test(document.querySelector("#turn-text")?.textContent ?? ""), null, { timeout: 15_000 });
    const before = await moveCount(p);
    record.undoLabel = await text(p, "#undo-button");
    await p.click("#undo-button");
    await p.waitForTimeout(300);
    record.undo = { before, after: await moveCount(p), message: await text(p, "#message") };
    record.undoShot = await shot(p, `${tag}-after-undo`);
  }
  const game = await playHumanVsAI(p);
  record.moves = game.moves;
  record.phase = await text(p, "#phase-label");
  record.turn = await text(p, "#turn-text");
  record.message = await text(p, "#message");
  record.endShot = await shot(p, `${tag}-end`);
  record.ok = /对局结束/u.test(record.phase) &&
    (!undo || record.undo.after === record.undo.before - 2);
  results.push(record);
  log(tag, record.ok, record.turn, record.moves);
  await context.close();
}

async function selfPlay({ gameType, ruleSet, topology, width, height, level, blackLevel }) {
  const tag = `self-${gameType}-${ruleSet ?? "std"}-${topology}`;
  const { page: p, context } = await page(tag);
  const record = { tag };
  const started = await startLocalAIGame(p, { gameType, ruleSet, topology, width, height, level, blackLevel, selfPlay: true });
  record.dialog = started.dialog;
  // Let a few moves happen, pause, undo one move, resume, play to the end.
  await p.waitForFunction(() => {
    const value = document.querySelector("#move-number")?.textContent ?? "";
    const match = /第 (\d+) 手/u.exec(value);
    return match && Number(match[1]) >= 7;
  }, null, { timeout: 30_000 });
  await p.click("#toggle-ai-autoplay");
  await p.waitForTimeout(700);
  const pausedAt = await moveCount(p);
  record.pauseLabel = await text(p, "#toggle-ai-autoplay");
  record.pauseHint = await text(p, "#ai-hint");
  await p.waitForTimeout(900);
  record.stayedPaused = (await moveCount(p)) === pausedAt;
  await p.click("#undo-button");
  await p.waitForTimeout(300);
  record.undo = { before: pausedAt, after: await moveCount(p), message: await text(p, "#message") };
  record.pausedShot = await shot(p, `${tag}-paused-after-undo`);
  await p.click("#toggle-ai-autoplay");
  await p.waitForFunction(() => /对局结束/u.test(document.querySelector("#phase-label")?.textContent ?? ""), null, { timeout: 240_000 });
  record.moves = await moveCount(p);
  record.turn = await text(p, "#turn-text");
  record.seats = [await text(p, "#ai-black-seat"), await text(p, "#ai-white-seat")];
  record.opponent = await text(p, ".ai-opponent-name");
  record.endShot = await shot(p, `${tag}-end`);
  record.ok = record.stayedPaused && record.undo.after === record.undo.before - 1;
  results.push(record);
  log(tag, record.ok, record.turn, record.moves);
  await context.close();
}

async function englishPass() {
  const tag = "english-othello-ai";
  const { page: p, context } = await page(tag, "en");
  const record = { tag };
  const started = await startLocalAIGame(p, { gameType: "othello", topology: "mobius", width: 6, height: 6, level: "hard", humanColor: "white" });
  record.dialog = started.dialog;
  await p.waitForTimeout(1500);
  record.leftovers = await cjkLeftovers(p);
  record.message = await text(p, "#message");
  record.opponent = await text(p, ".ai-opponent-name");
  record.shot = await shot(p, `${tag}`);
  record.ok = record.leftovers.length === 0;
  results.push(record);
  log(tag, record.ok, record.leftovers);
  await context.close();
}

try {
  await humanVsAI({ gameType: "gomoku", ruleSet: "freestyle", topology: "cylinder", width: 15, height: 15, level: "normal", undo: true });
  await humanVsAI({ gameType: "gomoku", ruleSet: "renju", topology: "torus", width: 15, height: 15, level: "hard", humanColor: "white" });
  await humanVsAI({ gameType: "othello", topology: "cylinder", width: 8, height: 8, level: "normal", undo: true });
  await humanVsAI({ gameType: "othello", topology: "torus", width: 6, height: 6, level: "hard" });
  await humanVsAI({ gameType: "othello", topology: "mobius", width: 8, height: 6, level: "easy", humanColor: "white" });
  await selfPlay({ gameType: "gomoku", ruleSet: "renju", topology: "mobius", width: 15, height: 15, level: "normal", blackLevel: "hard" });
  await selfPlay({ gameType: "othello", topology: "torus", width: 8, height: 8, level: "hard", blackLevel: "easy" });
  await englishPass();
} catch (error) {
  console.log("FAILED", error.stack);
}
console.log(JSON.stringify(results, null, 1));
console.log("PROBLEMS", JSON.stringify(problems, null, 1));
await browser.close();
