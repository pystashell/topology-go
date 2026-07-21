import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const htmlSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");

function functionSource(name) {
  const signature = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = signature.exec(mainSource);
  assert.ok(match, `expected ${name} to be defined`);
  const start = match.index;
  const remainder = mainSource.slice(start + match[0].length);
  const nextFunction = /\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.exec(remainder);
  return mainSource.slice(
    start,
    nextFunction ? start + match[0].length + nextFunction.index : mainSource.length,
  );
}

test("same-room next-game adjustment reuses the shared settings surface", () => {
  assert.match(mainSource, /function enterNextGameSetup\(/);
  assert.match(mainSource, /elements\.confirmNextGame.*addEventListener/);
  assert.match(htmlSource, /id="next-game-setup"/);
  assert.match(htmlSource, /id="confirm-next-game"/);
  assert.match(htmlSource, />\s*使用当前设置开始下一局\s*</);
  assert.doesNotMatch(htmlSource, /id="room-rematch-setup"/);
  assert.doesNotMatch(htmlSource, /id="start-room-rematch"/);
  assert.doesNotMatch(htmlSource, /id="lobby-overlay"/);
});

test("next-game preview cannot be overwritten by the finished game's analysis render", () => {
  const renderSource = functionSource("renderCurrentAnalysisPosition");
  assert.match(
    renderSource,
    /if \(isNextGameSetup\(\) && rematchPreviewGame\)[\s\S]*renderBoardPosition\(rematchPreviewGame\.getState\(\), null\)[\s\S]*return/,
  );
});

test("next-game setup stays mutually exclusive with replay and AI reconfiguration", () => {
  const replaySource = functionSource("enterReplay");
  const aiStartSource = functionSource("startAIGame");
  const replayAvailabilitySource = functionSource("syncReplayEntryAvailability");

  assert.match(replaySource, /if \(isNextGameSetup\(\)\)[\s\S]*return/);
  assert.match(
    aiStartSource,
    /matchLifecycle === MATCH_LIFECYCLE_FINISHED \|\| isNextGameSetup\(\)/,
  );
  assert.match(replayAvailabilitySource, /nextGameSetup = isNextGameSetup\(\)/);
  assert.match(replayAvailabilitySource, /reviewing \|\| nextGameSetup \|\| !matchStarted/);
  assert.match(
    mainSource,
    /elements\.changeAiSettings\.disabled = reviewing \|\| finished \|\| rematchSetup/,
  );
  const setupSource = functionSource("enterNextGameSetup");
  assert.match(setupSource, /setChatPointPicking\(false\)/);
});

test("finished games offer both an identical immediate rematch and configurable setup", () => {
  assert.match(htmlSource, /id="post-game-actions"/);
  assert.match(htmlSource, /id="direct-rematch"/);
  assert.match(htmlSource, /id="adjust-next-game"/);
  assert.match(htmlSource, />\s*直接进行下一局\s*</);
  assert.match(htmlSource, />\s*调整下一局设置\s*</);
  assert.doesNotMatch(htmlSource, /id="exit-room-button"/);
  assert.doesNotMatch(htmlSource, /id="return-to-lobby"/);
  assert.doesNotMatch(htmlSource, /id="rematch-button"/);
  assert.doesNotMatch(htmlSource, />\s*再来一局\s*</);

  assert.match(htmlSource, /id="next-game-setup"/);
  assert.match(htmlSource, /id="confirm-next-game"/);
  assert.match(mainSource, /function enterNextGameSetup\(/);
  assert.match(mainSource, /async function startConfiguredNextGame\(/);
  assert.match(mainSource, /async function startImmediateRematch\(/);

  const enterSetupSource = functionSource("enterNextGameSetup");
  assert.doesNotMatch(enterSetupSource, /startNewGame\s*\(/);
  assert.doesNotMatch(
    enterSetupSource,
    /dispatchMatchAction\s*\(\s*MATCH_ACTION_NEW_GAME/,
  );
  assert.match(enterSetupSource, /setSidebarTab\("settings"/);
  assert.match(enterSetupSource, /reflectPreviousGameOptions\s*\(/);

  const confirmSource = functionSource("startConfiguredNextGame");
  assert.match(confirmSource, /startNewGame\s*\(/);

  const immediateSource = functionSource("startImmediateRematch");
  assert.match(immediateSource, /startNewGame\s*\(/);
  assert.match(immediateSource, /getPreviousGameOptions\s*\(/);
  assert.match(immediateSource, /prepareLocalNextGameAIState\s*\(/);
  assert.match(immediateSource, /applyLocalNextGameAIState\s*\(/);
  assert.doesNotMatch(immediateSource, /aiActive\s*=\s*false/);
  assert.doesNotMatch(immediateSource, /aiMatchMode\s*=/);
  assert.doesNotMatch(immediateSource, /aiHumanColor\s*=/);
  assert.doesNotMatch(immediateSource, /aiGameModelId\s*=/);

  assert.match(confirmSource, /prepareLocalNextGameAIState\s*\(/);
  assert.match(confirmSource, /applyLocalNextGameAIState\s*\(/);
  assert.doesNotMatch(confirmSource, /aiActive\s*=\s*false/);
  const reflectSource = functionSource("reflectPreviousGameOptions");
  assert.match(reflectSource, /getPreviousGameOptions\s*\(/);

  const applyRoomSource = functionSource("applyOnlineRoom");
  assert.match(applyRoomSource, /onlineNextGameTransition\s*\(/);

  assert.match(mainSource, /elements\.directRematch\.addEventListener/);
  assert.match(mainSource, /startImmediateRematch\s*\(/);
  assert.match(mainSource, /elements\.adjustNextGame\.addEventListener/);
  assert.match(mainSource, /enterNextGameSetup\s*\(/);
  assert.match(mainSource, /elements\.confirmNextGame.*addEventListener/);
  assert.match(mainSource, /startConfiguredNextGame\s*\(/);
  assert.match(mainSource, /moveInto\("game", \[[\s\S]*"#post-game-actions"/);
});
