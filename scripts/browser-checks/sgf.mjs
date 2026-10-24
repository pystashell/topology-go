// SGF for every game: AI self-play a Gomoku (Renju, torus) and an Othello
// (Möbius) game, export each record, import it on a fresh page and step
// through the replay. Also checks a Go import still works, that a record of
// a game we do not play gets the friendly note, and an English pass.
import { readFileSync } from "node:fs";
import { BASE, cjkLeftovers, launch, openPage, problems, shot, text } from "./lib.mjs";
import { finished, installCspWatch, log, startLocalAIGame } from "./play.mjs";

const browser = await launch();
const results = [];

async function newPage(name, locale = "zh-CN") {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  await context.addInitScript((value) => {
    try { localStorage.setItem("3d-baduk-locale-v1", value); } catch {}
  }, locale);
  await installCspWatch(context);
  return openPage(browser, { context, name, locale });
}

async function importRecord(page, name, sgf) {
  await page.click('[data-sidebar-tab="record"]');
  await page.setInputFiles("#import-sgf-file", { name, mimeType: "application/x-go-sgf", buffer: Buffer.from(sgf) });
  await page.waitForTimeout(600);
  return text(page, "#message");
}

async function roundTrip({ gameType, ruleSet, topology, width, height, gm }) {
  const tag = `sgf-${gameType}-${topology}`;
  const record = { tag };
  const { page, context } = await newPage(tag);
  await startLocalAIGame(page, { gameType, ruleSet, topology, width, height, level: "easy", selfPlay: true });
  const started = Date.now();
  while (!(await finished(page))) {
    if (Date.now() - started > 240_000) throw new Error(`${tag}: self-play took too long`);
    await page.waitForTimeout(250);
  }
  record.result = await text(page, "#turn-text");
  await page.click('[data-sidebar-tab="record"]');
  record.recordActionsVisible = await page.locator(".record-actions").isVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#export-sgf")]);
  record.filename = download.suggestedFilename();
  const sgf = readFileSync(await download.path(), "utf8");
  record.header = sgf.split("\n")[0].slice(0, 120);
  record.exportMessage = await text(page, "#message");
  await context.close();

  // A fresh page opens on Go; importing switches the replay to the record's game.
  const fresh = await newPage(`${tag}-import`);
  await fresh.page.goto(`${BASE}/single`);
  await fresh.page.waitForTimeout(800);
  record.importMessage = await importRecord(fresh.page, record.filename, sgf);
  record.replayVisible = await fresh.page.locator("#replay-panel").isVisible();
  record.progress = await text(fresh.page, "#replay-progress");
  await fresh.page.click("#replay-last");
  await fresh.page.waitForTimeout(300);
  record.atEnd = await text(fresh.page, "#replay-progress");
  record.endTurn = await text(fresh.page, "#turn-text");
  record.shot = await shot(fresh.page, `${tag}-imported`);
  record.ok = record.recordActionsVisible &&
    sgf.includes(`GM[${gm}]`) && sgf.includes(`XTOP[${topology}]`) &&
    record.filename.startsWith(`topology-go-${gameType}-${topology}-`) &&
    /^已导入 .+，共 \d+ 手；可播放或切换视图。/u.test(record.importMessage) &&
    record.replayVisible;
  results.push(record);
  log(tag, record.ok, record.importMessage);
  await fresh.context.close();
  return sgf;
}

await roundTrip({ gameType: "gomoku", ruleSet: "renju", topology: "torus", width: 15, height: 15, gm: 4 });
const othello = await roundTrip({ gameType: "othello", topology: "mobius", width: 8, height: 8, gm: 2 });

{
  const { page, context } = await newPage("sgf-other");
  await page.goto(`${BASE}/single`);
  await page.waitForTimeout(800);
  const go = await importRecord(page, "go.sgf", "(;FF[4]GM[1]SZ[9]XTOP[torus];B[ee];W[cc])");
  const chess = await importRecord(page, "chess.sgf", "(;FF[4]GM[3]SZ[8])");
  results.push({
    tag: "sgf-go-and-unknown",
    go,
    chess,
    ok: /^已导入 go\.sgf，共 2 手；可播放、切换视图或做 AI 分析。/u.test(go) &&
      chess.includes("不是围棋、五子棋或黑白棋棋谱（GM[3]）"),
  });
  await context.close();
}

{
  const { page, context } = await newPage("sgf-english", "en");
  await page.goto(`${BASE}/single`);
  await page.waitForTimeout(800);
  const message = await importRecord(page, "othello.sgf", othello);
  const leftovers = await cjkLeftovers(page);
  results.push({
    tag: "sgf-english",
    message,
    leftovers,
    ok: /^Imported othello\.sgf with \d+ moves\. You can replay or change views\./u.test(message) &&
      leftovers.length === 0,
  });
  await context.close();
}

await browser.close();
console.log(JSON.stringify({ results, problems }, null, 2));
process.exitCode = results.every((item) => item.ok) && problems.length === 0 ? 0 : 1;
