// Games against AI in the page: the hint button, the AI's pause and the
// Othello flip wave. For Othello (8x8 cylinder), Gomoku (15x15) and Go (9x9,
// KataGo b10) the human asks for a hint on their turn, plays the hinted
// point, and the AI answers no sooner than a second later; the hint button
// is off during the AI's turn; undo clears the hint. The Othello move is
// screenshotted while its discs turn over ring by ring.
import { BASE, clickPoint, launch, openPage, problems, scanBoard, shot, text } from "./lib.mjs";
import { openAIDialog, startLocalAIGame } from "./play.mjs";
import { configureBoard, setView } from "./lib.mjs";

const COLS = "ABCDEFGHJKLMNOPQRSTUVWXYZ";
const pointOf = (label, height) => ({ row: height - Number(label.slice(1)), col: COLS.indexOf(label[0]) });

const GAMES = [
  { gameType: "othello", topology: "cylinder", width: 8, height: 8, timeout: 30_000 },
  { gameType: "gomoku", ruleSet: "freestyle", topology: "cylinder", width: 15, height: 15, timeout: 30_000 },
  { gameType: "go", topology: "cylinder", width: 9, height: 9, timeout: 180_000 },
];

const browser = await launch();
const results = [];
for (const setup of GAMES) {
  const { page } = await openPage(browser, { name: `hints-${setup.gameType}` });
  const record = { game: setup.gameType };
  try {
    await page.goto(BASE);
    if (setup.gameType === "go") {
      // KataGo has models instead of levels.
      await page.goto(`${BASE}/single`);
      await page.waitForTimeout(800);
      await configureBoard(page, setup);
      await setView(page, "flat");
      await openAIDialog(page);
      await page.selectOption("#ai-model", "b10");
      await page.click("#start-ai");
      await page.waitForTimeout(300);
    } else {
      await startLocalAIGame(page, { ...setup, level: "easy" });
    }
    await page.click('[data-sidebar-tab="game"]').catch(() => {});
    // Time every change of the move counter inside the page.
    await page.evaluate(() => {
      window.__moveTimes = [];
      const node = document.querySelector("#move-number");
      new MutationObserver(() => window.__moveTimes.push({ at: performance.now(), text: node.textContent }))
        .observe(node, { childList: true, characterData: true, subtree: true });
    });
    const map = await scanBoard(page, { step: 4 });
    record.hintVisible = await page.isVisible("#hint-button");
    record.hintEnabled = await page.isEnabled("#hint-button");
    await page.click("#hint-button");
    await page.waitForFunction(
      () => /^提示：AI 建议/u.test(document.querySelector("#message")?.textContent ?? ""),
      null,
      { timeout: setup.timeout },
    );
    record.hintMessage = await text(page, "#message");
    record.hintShot = await shot(page, `hint-${setup.gameType}`);
    const label = /下在 ([A-Z]\d+)/u.exec(record.hintMessage)?.[1];
    record.hintLabel = label;
    const { row, col } = pointOf(label, setup.height);
    const before = await text(page, "#move-number");
    await page.evaluate(() => { window.__moveTimes = []; });
    await clickPoint(page, map, row, col, setup.height);
    record.hintDuringAI = { visible: await page.isVisible("#hint-button"), enabled: await page.isEnabled("#hint-button") };
    if (setup.gameType === "othello") {
      // The human's discs turn over ring by ring.
      await page.waitForTimeout(150);
      record.waveShots = [await shot(page, "flip-wave-1")];
      await page.waitForTimeout(150);
      record.waveShots.push(await shot(page, "flip-wave-2"));
    }
    await page.waitForFunction(
      (start) => (window.__moveTimes ?? []).filter((entry) => entry.text !== start).map((entry) => entry.text)
        .filter((value, index, all) => all.indexOf(value) === index).length >= 2,
      before,
      { timeout: setup.timeout },
    );
    const times = await page.evaluate(() => window.__moveTimes);
    const distinct = [];
    for (const entry of times) if (!distinct.length || distinct.at(-1).text !== entry.text) distinct.push(entry);
    record.moveTexts = distinct.map((entry) => entry.text);
    record.aiPauseMs = Math.round(distinct[1].at - distinct[0].at);
    record.afterAI = { hintEnabled: await page.isEnabled("#hint-button"), message: await text(page, "#message") };
    record.afterAIShot = await shot(page, `after-ai-${setup.gameType}`);
    // Ask again, then undo: the hint is cleared with the position.
    await page.click("#hint-button");
    await page.waitForFunction(
      () => /^提示：AI 建议/u.test(document.querySelector("#message")?.textContent ?? ""),
      null,
      { timeout: setup.timeout },
    );
    await page.click("#undo-button");
    await page.waitForTimeout(400);
    record.afterUndo = {
      move: await text(page, "#move-number"),
      hintEnabled: await page.isEnabled("#hint-button"),
      message: await text(page, "#message"),
    };
    record.ok = record.hintVisible && record.hintEnabled && Boolean(label) &&
      record.aiPauseMs >= 1_000 && record.hintDuringAI.enabled === false &&
      record.afterAI.hintEnabled && /第 1 手/u.test(record.afterUndo.move);
  } catch (error) {
    record.error = error.stack;
    record.failShot = await shot(page, `hints-fail-${setup.gameType}`).catch(() => null);
  }
  results.push(record);
  await page.context().close();
}
await browser.close();
console.log(JSON.stringify({ results, problems }, null, 2));
process.exitCode = results.every((record) => record.ok) && problems.length === 0 ? 0 : 1;
