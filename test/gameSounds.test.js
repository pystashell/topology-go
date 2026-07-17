import assert from "node:assert/strict";
import test from "node:test";

import {
  GameSounds,
  createCaptureSoundPlan,
  createStoneSoundPlan,
} from "../src/audio/gameSounds.js";

test("stone sound is a short low wooden strike with bounded variation", () => {
  const low = createStoneSoundPlan(2, -10);
  const high = createStoneSoundPlan(2, 10);

  assert.equal(low.kind, "stone");
  assert.equal(low.at, 2);
  assert.ok(low.duration < 0.08);
  assert.equal(low.tones.length, 2);
  assert.ok(low.tones[0].startFrequency < high.tones[0].startFrequency);
  assert.ok(low.tones[0].endFrequency < low.tones[0].startFrequency);
  assert.ok(high.noise.frequency < 1_200);
});

test("capture count changes the crisp response but remains capped", () => {
  assert.equal(createCaptureSoundPlan(0), null);
  assert.equal(createCaptureSoundPlan(-2), null);

  const one = createCaptureSoundPlan(1, 3);
  const group = createCaptureSoundPlan(8, 3);
  const hugeGroup = createCaptureSoundPlan(100_000, 3);

  assert.equal(one.kind, "capture");
  assert.equal(one.at, 3);
  assert.equal(one.tones.length, 2);
  assert.equal(group.tones.length, 6);
  assert.equal(hugeGroup.tones.length, 6);
  assert.ok(group.duration > one.duration);
  assert.ok(hugeGroup.duration <= 0.15);
  assert.ok(hugeGroup.noise.frequency <= 2_640);
});

test("sound player is harmless when Web Audio is unavailable", async () => {
  const sounds = new GameSounds({ contextFactory: () => null });

  assert.equal(await sounds.unlock(), false);
  assert.equal(await sounds.playStone(), false);
  assert.equal(await sounds.playCapture(4), false);
  assert.equal(sounds.setEnabled(false), false);
  assert.equal(await sounds.destroy(), true);
  assert.equal(await sounds.destroy(), false);
});

test("disabled sound does not instantiate an audio context", async () => {
  let factoryCalls = 0;
  const sounds = new GameSounds({
    enabled: false,
    contextFactory: () => {
      factoryCalls += 1;
      return null;
    },
  });

  assert.equal(await sounds.unlock(), false);
  assert.equal(await sounds.playStone(), false);
  assert.equal(await sounds.playCapture(0), false);
  assert.equal(factoryCalls, 0);
});
