// Go keeps KataGo: the AI dialog offers b10/b18 without difficulty, and a
// local 9x9 human-vs-KataGo game gets an AI reply. Then switching the same
// page to Gomoku offers Rapfi, and back to Go offers KataGo again.
import { BASE, configureBoard, launch, openPage, problems, scanBoard, setView, shot, text } from "./lib.mjs";
import { installCspWatch, log, moveCount, playAnyLegal } from "./play.mjs";

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
await context.addInitScript(() => {
  try { localStorage.setItem("3d-baduk-locale-v1", "zh-CN"); } catch {}
});
await installCspWatch(context);
const { page } = await openPage(browser, { context, name: "go" });
const record = {};
try {
  await page.goto(`${BASE}/single`);
  await page.waitForTimeout(800);
  await configureBoard(page, { gameType: "go", topology: "cylinder", width: 9, height: 9 });
  await page.click("[data-open-invite]");
  await page.waitForSelector("#invite-dialog[open]");
  await page.click("#invite-ai");
  await page.waitForSelector("#ai-dialog[open]");
  record.goDialog = {
    models: await page.$$eval("#ai-model option", (options) => options.map((o) => `${o.value}:${o.textContent}`)),
    levelVisible: await page.locator("#ai-level-field").isVisible(),
    noteVisible: await page.locator("#ai-level-note").isVisible(),
    title: await text(page, "#ai-dialog-title"),
  };
  await page.click("#start-ai");
  await setView(page, "flat");
  const map = await scanBoard(page, { step: 5 });
  await playAnyLegal(page, map);
  await page.waitForFunction(() => /第 3 手/u.test(document.querySelector("#move-number")?.textContent ?? ""), null, { timeout: 120_000 });
  record.goAfterAI = { moves: await moveCount(page), message: await text(page, "#message"), opponent: await text(page, ".ai-opponent-name") };
  record.goShot = await shot(page, "go-katago-reply");
  await page.click("#leave-ai");
  await page.waitForTimeout(500);
  await configureBoard(page, { gameType: "gomoku" });
  await page.click("[data-open-invite]");
  await page.click("#invite-ai");
  await page.waitForSelector("#ai-dialog[open]");
  record.gomokuModels = await page.$$eval("#ai-model option", (options) => options.map((o) => o.value));
  await page.click("#cancel-ai");
  await configureBoard(page, { gameType: "go" });
  await page.click("[data-open-invite]");
  await page.click("#invite-ai");
  await page.waitForSelector("#ai-dialog[open]");
  record.goModelsAgain = await page.$$eval("#ai-model option", (options) => options.map((o) => o.value));
  record.levelVisibleAgain = await page.locator("#ai-level-field").isVisible();
} catch (error) {
  console.log("FAILED", error.stack);
}
log(JSON.stringify(record, null, 1));
console.log("PROBLEMS", JSON.stringify(problems, null, 1));
await browser.close();
