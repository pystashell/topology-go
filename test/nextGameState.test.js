import assert from "node:assert/strict";
import test from "node:test";

import {
  onlineNextGameTransition,
  prepareLocalNextGameAIState,
  previousGameOptions,
} from "../src/game/nextGameState.js";
import { RoomEngine } from "../src/multiplayer/roomEngine.js";

test("the previous game's complete board and clock configuration is preserved", () => {
  assert.deepEqual(
    previousGameOptions(
      {
        width: 30,
        height: 20,
        topology: "mobius",
        scoringRule: "japanese",
        komi: 6.5,
      },
      {
        mainTimeSeconds: 1_800,
        byoYomiPeriods: 5,
        byoYomiSeconds: 30,
        outcome: { reason: "timeout", winner: "white", loser: "black" },
      },
    ),
    {
      width: 30,
      height: 20,
      topology: "mobius",
      scoringRule: "japanese",
      komi: 6.5,
      mainTimeSeconds: 1_800,
      byoYomiPeriods: 5,
      byoYomiSeconds: 30,
    },
  );

  assert.deepEqual(
    previousGameOptions({
      size: 13,
      topology: "torus",
      scoringRule: "chinese",
      komi: 7.5,
    }),
    {
      width: 13,
      height: 13,
      size: 13,
      topology: "torus",
      scoringRule: "chinese",
      komi: 7.5,
      mainTimeSeconds: 0,
      byoYomiPeriods: 0,
      byoYomiSeconds: 0,
    },
  );
});

test("local AI rematches preserve model, human color and match mode", () => {
  const humanVsAI = {
    active: true,
    matchMode: "human-ai",
    humanColor: "white",
    modelId: "b18",
    autoplayPaused: false,
  };
  assert.deepEqual(prepareLocalNextGameAIState(humanVsAI), humanVsAI);

  const selfPlay = {
    active: true,
    matchMode: "ai-ai",
    humanColor: "white",
    modelId: "b10",
    autoplayPaused: true,
  };
  assert.deepEqual(prepareLocalNextGameAIState(selfPlay), {
    ...selfPlay,
    autoplayPaused: false,
  });

  const localHumanGame = {
    active: false,
    matchMode: "human-ai",
    humanColor: "black",
    modelId: "b10",
    autoplayPaused: true,
  };
  assert.deepEqual(prepareLocalNextGameAIState(localHumanGame), localHumanGame);
});

function timeoutRoom(overrides = {}) {
  return {
    revision: 12,
    positionToken: "pos-v1-timeout-position",
    moveCount: 41,
    game: {
      phase: "finished",
      result: { reason: "timeout", winner: "white", loser: "black" },
    },
    timeControl: {
      outcome: { reason: "timeout", winner: "white", loser: "black" },
    },
    ...overrides,
  };
}

test("ordinary online snapshots do not dismiss a timeout rematch preview", () => {
  const previousRoom = timeoutRoom();
  const presenceSnapshot = timeoutRoom({ revision: 13 });
  assert.deepEqual(
    onlineNextGameTransition({
      previousRoom,
      nextRoom: presenceSnapshot,
      setupActive: true,
    }),
    {
      positionChanged: false,
      nextRoundStarted: false,
      exitSetup: false,
    },
  );

  // Even a transient live-looking snapshot is not a new round without a new
  // authoritative position token.
  const samePositionSnapshot = timeoutRoom({
    revision: 14,
    moveCount: 0,
    game: { phase: "play", result: null },
    timeControl: { outcome: null },
  });
  assert.equal(onlineNextGameTransition({
    previousRoom,
    nextRoom: samePositionSnapshot,
    setupActive: true,
  }).exitSetup, false);
});

test("only an authoritative empty new online round dismisses the setup preview", () => {
  const previousRoom = timeoutRoom();
  const newRound = timeoutRoom({
    revision: 15,
    positionToken: "pos-v1-new-round-position",
    moveCount: 0,
    game: { phase: "play", result: null },
    timeControl: { outcome: null },
  });
  assert.deepEqual(
    onlineNextGameTransition({
      previousRoom,
      nextRoom: newRound,
      setupActive: true,
    }),
    {
      positionChanged: true,
      nextRoundStarted: true,
      exitSetup: true,
    },
  );

  assert.equal(onlineNextGameTransition({
    previousRoom,
    nextRoom: { ...newRound, moveCount: 1 },
    setupActive: true,
  }).exitSetup, false);
  assert.equal(onlineNextGameTransition({
    previousRoom,
    nextRoom: { ...newRound, game: { phase: "finished" } },
    setupActive: true,
  }).exitSetup, false);
  assert.equal(onlineNextGameTransition({
    previousRoom,
    nextRoom: newRound,
    setupActive: false,
  }).exitSetup, false);
});

test("real room timeout snapshots keep their token until the server creates a new game", () => {
  const room = RoomEngine.create({
    code: "NXT234",
    name: "Black",
    size: 9,
    mainTimeSeconds: 1,
    playerId: "black-player",
    tokenHash: "a".repeat(64),
    now: 1_000,
  });
  room.join({
    name: "White",
    role: "player",
    playerId: "white-player",
    tokenHash: "b".repeat(64),
    now: 2_000,
  });

  const timedOut = room.advance(3_000).room;
  const ordinarySnapshot = room.snapshot(3_100);
  assert.equal(timedOut.game.result.reason, "timeout");
  assert.equal(ordinarySnapshot.positionToken, timedOut.positionToken);
  assert.equal(onlineNextGameTransition({
    previousRoom: timedOut,
    nextRoom: ordinarySnapshot,
    setupActive: true,
  }).exitSetup, false);

  const nextGame = room.applyAction({
    playerId: "black-player",
    action: "new_game",
    payload: { size: 9, topology: "cylinder" },
    now: 3_200,
  }).room;
  assert.notEqual(nextGame.positionToken, timedOut.positionToken);
  assert.equal(onlineNextGameTransition({
    previousRoom: ordinarySnapshot,
    nextRoom: nextGame,
    setupActive: true,
  }).exitSetup, true);
});
