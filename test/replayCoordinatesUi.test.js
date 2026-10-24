import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import {
  activeReviewCandidate,
  createReviewCandidateState,
  formatReviewVariation,
  reduceReviewCandidateState,
} from "../src/ai/replayReview.js";
import { COORDINATE_LETTERS } from "../src/multiplayer/chat.js";
import { appSource } from "./helpers/appSource.js";

const main = appSource();
const slice = (from, to) => {
  const start = main.indexOf(from);
  const end = main.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `expected main.js to contain ${from}`);
  return main.slice(start, end);
};

const source = [
  slice("function boardWidth(", "function boardPointCount("),
  slice("function displayedBoardState()", "function displayedTopology()"),
  slice("function formatReviewMove(", "function activeBoardView()"),
  slice("function applyReviewCandidateAction(", "function syncReplayEntryAvailability()"),
  slice("function handleHover(", "for (const button of elements.sidebarTabs)"),
  "({ applyReviewCandidateAction, handleHover })",
].join("\n");

function harness() {
  const element = () => ({
    textContent: "",
    hidden: true,
    querySelectorAll: () => [],
  });
  const elements = {
    aiReviewCandidates: element(),
    aiVariationPreview: element(),
    aiVariationTitle: element(),
    aiVariationLine: element(),
    coordinateHint: element(),
  };
  // A 13 x 7 SGF replay while the live game is still the default 19 x 19.
  const frame = { width: 13, height: 7, topology: "cylinder" };
  const context = {
    elements,
    game: { width: 19, height: 19, topology: "cylinder" },
    replaySession: { index: 0, frames: [frame] },
    liveDisplayedGame: () => context.game,
    reviewCandidateState: createReviewCandidateState(),
    chatPointPicking: false,
    COORDINATE_LETTERS,
    activeReviewCandidate,
    formatReviewVariation,
    reduceReviewCandidateState,
    renderCurrentAnalysisPosition() {},
    syncBoardCandidateHover() {},
    isMobiusTopology: () => false,
    isTorusTopology: () => false,
  };
  return { context, elements, ...vm.runInNewContext(source, context) };
}

test("replay variation titles and lines use the replay frame's height", () => {
  const { applyReviewCandidateAction, elements } = harness();
  const candidate = {
    key: "play:2:3",
    rank: 1,
    move: { type: "play", row: 2, col: 3 },
    variation: [{ type: "play", row: 2, col: 3 }, { type: "play", row: 6, col: 0 }],
  };
  applyReviewCandidateAction({ type: "toggle-pin", candidate }, [candidate]);
  assert.equal(elements.aiVariationPreview.hidden, false);
  assert.equal(elements.aiVariationTitle.textContent, "候选 1 · D5");
  assert.match(elements.aiVariationLine.textContent, /D5/u);
  assert.match(elements.aiVariationLine.textContent, /A1/u);
  assert.doesNotMatch(elements.aiVariationTitle.textContent, /D17/u);
});

test("replay hover coordinates use the replay frame instead of the live game", () => {
  const { handleHover, elements } = harness();
  handleHover({ row: 2, col: 3 });
  assert.equal(elements.coordinateHint.textContent, "D5");
  handleHover({ row: 6, col: 12 });
  assert.match(elements.coordinateHint.textContent, /^N1 · /u);
});

test("every review coordinate in main.js passes an explicit board height", () => {
  const calls = [...main.matchAll(/formatReviewMove\(([^()]*(?:\([^()]*\))?[^()]*)\)/gu)]
    .map((match) => match[1])
    .filter((args) => !args.startsWith("move, height"));
  assert.ok(calls.length >= 5);
  for (const args of calls) {
    assert.match(args, /,/u, `formatReviewMove(${args}) must not default to the live board height`);
  }
});
