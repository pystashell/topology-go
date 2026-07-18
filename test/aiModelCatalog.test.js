import test from "node:test";
import assert from "node:assert/strict";

import {
  AI_MODEL_IDS,
  DEFAULT_AI_MODEL_ID,
  formatModelDownloadProgress,
  getAIModel,
  normalizeAIModelId,
} from "../src/ai/modelCatalog.js";

test("AI model catalog exposes the lightweight and enhanced choices", () => {
  assert.deepEqual(AI_MODEL_IDS, ["b10", "b18"]);
  assert.equal(DEFAULT_AI_MODEL_ID, "b10");
  assert.equal(getAIModel("b10").heavy, false);
  assert.equal(getAIModel("b18").heavy, true);
  assert.equal(getAIModel("b18").requiresWebGPU, true);
  assert.equal(getAIModel("b18").parts.length, 4);
  assert.equal(getAIModel("b18").compressedBytes, 97_898_094);
});

test("unknown model ids safely fall back to b10", () => {
  assert.equal(normalizeAIModelId("b18"), "b18");
  assert.equal(normalizeAIModelId("anything-else"), "b10");
  assert.equal(normalizeAIModelId(null), "b10");
  assert.equal(getAIModel("https://example.com/model.bin").id, "b10");
});

test("model download progress is bounded and human readable", () => {
  assert.equal(formatModelDownloadProgress(0, "b18"), "0.0 / 93.4 MB");
  assert.equal(
    formatModelDownloadProgress(Number.MAX_SAFE_INTEGER, "b18"),
    "93.4 / 93.4 MB",
  );
});
