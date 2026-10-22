// Shared steps for the Gomoku/Othello AI browser checks.
import { BASE, configureBoard, scanBoard, setView, shot, text } from "./lib.mjs";

export const log = (...args) => console.log(new Date().toISOString().slice(11, 19), ...args);

export async function installCspWatch(context) {
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
}

export async function moveCount(page) {
  const value = await text(page, "#move-number");
  const live = /第 (\d+) 手|Move (\d+)/u.exec(value);
  if (live) return Number(live[1] ?? live[2]) - 1;
  const done = /^(\d+) (?:手|move)/u.exec(value);
  return done ? Number(done[1]) : 0;
}

export async function finished(page) {
  const phase = await text(page, "#phase-label");
  return /对局结束|Game over|认输终局/u.test(phase);
}

/** Try points (row-major from a shuffled order) until one is accepted. */
export async function playAnyLegal(page, map, { random = Math.random } = {}) {
  const before = await moveCount(page);
  const labels = Object.keys(map).sort(() => random() - 0.5);
  for (const key of labels) {
    const point = map[key];
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.up();
    const after = await moveCount(page);
    if (after > before || await finished(page)) return key;
  }
  throw new Error("no point was accepted");
}

export async function humanTurn(page) {
  const turn = await text(page, "#turn-text");
  return /轮到你落子|Your move|Your turn/u.test(turn);
}

/** Play a local human-vs-AI game to its end; the human plays any legal point. */
export async function playHumanVsAI(page, { maxMoves = 400, onMove = null } = {}) {
  await setView(page, "flat");
  const map = await scanBoard(page, { step: 5 });
  let humanMoves = 0;
  const started = Date.now();
  while (!(await finished(page))) {
    if (Date.now() - started > 240_000) throw new Error("game took too long");
    if (await humanTurn(page)) {
      await playAnyLegal(page, map);
      humanMoves += 1;
      if (onMove) await onMove(humanMoves);
      if (humanMoves > maxMoves) throw new Error("too many moves");
    } else {
      await page.waitForTimeout(80);
    }
  }
  return { humanMoves, moves: await moveCount(page) };
}

export async function openAIDialog(page, { selfPlay = false } = {}) {
  await page.click("[data-open-invite]");
  await page.waitForSelector("#invite-dialog[open]");
  await page.click(selfPlay ? "#invite-self-play" : "#invite-ai");
  await page.waitForSelector("#ai-dialog[open]");
}

export async function startLocalAIGame(page, { gameType, ruleSet, topology, width, height, level = "normal", blackLevel, humanColor = "black", selfPlay = false, view = "flat" }) {
  await page.goto(`${BASE}/single`);
  await page.waitForTimeout(800);
  await configureBoard(page, { gameType, ruleSet, topology, width, height });
  await setView(page, view);
  await openAIDialog(page, { selfPlay });
  const dialog = {
    levelVisible: await page.locator("#ai-level-field").isVisible(),
    blackLevelVisible: await page.locator("#ai-black-level-field").isVisible(),
    modelOptions: await page.$$eval("#ai-model option", (options) => options.map((o) => `${o.value}:${o.textContent}`)),
    warning: await text(page, "#ai-model-warning-title"),
    title: await text(page, "#ai-dialog-title"),
  };
  await page.selectOption("#ai-level", level);
  if (selfPlay) await page.selectOption("#ai-black-level", blackLevel ?? level);
  else await page.selectOption("#ai-human-color", humanColor);
  const dialogShot = await shot(page, `dialog-${gameType}-${selfPlay ? "self" : "human"}`);
  await page.click("#start-ai");
  await page.waitForTimeout(300);
  return { dialog, dialogShot };
}
