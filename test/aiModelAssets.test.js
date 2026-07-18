import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getAIModel } from "../src/ai/modelCatalog.js";

const STATIC_ASSET_LIMIT = 25 * 1024 * 1024;

function assetPath(url) {
  return fileURLToPath(new URL(`../public${url}`, import.meta.url));
}

test("b18 model chunks fit Cloudflare and reconstruct the official model", () => {
  const model = getAIModel("b18");
  const hash = createHash("sha256");
  let total = 0;
  let firstChunk;
  let lastChunk;

  model.parts.forEach((part, index) => {
    const path = assetPath(part);
    const size = statSync(path).size;
    assert.ok(size < STATIC_ASSET_LIMIT, `${part} must stay below 25 MiB`);
    const bytes = readFileSync(path);
    hash.update(bytes);
    total += bytes.byteLength;
    if (index === 0) firstChunk = bytes;
    if (index === model.parts.length - 1) lastChunk = bytes;
  });

  assert.equal(total, model.compressedBytes);
  assert.equal(firstChunk[0], 0x1f);
  assert.equal(firstChunk[1], 0x8b);
  assert.equal(lastChunk.readUInt32LE(lastChunk.length - 4), 105_532_578);
  assert.equal(
    hash.digest("hex"),
    "9d7a6afed8ff5b74894727e156f04f0cd36060a24824892008fbb6e0cba51f1d",
  );
});

test("the deployed b18 copy includes its required network notice", () => {
  const notice = readFileSync(
    fileURLToPath(new URL("../public/KATAGO_NETWORK_LICENSE.txt", import.meta.url)),
    "utf8",
  );
  assert.match(notice, /Copyright 2026 David J Wu \("lightvector"\)\./);
  assert.match(notice, /permission notice shall be included in all/i);
  assert.match(notice, /THE SOFTWARE IS PROVIDED "AS IS"/);
});
