import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MODEL_CACHE_NAME,
  loadModelPart,
  modelCacheKey,
  openModelCache,
  purgeModel,
} from "../src/ai/modelCache.js";
import { getAIModel } from "../src/ai/modelCatalog.js";

const BASE = "https://baduk.example/assets/katagoWorker.js";

class FakeCache {
  constructor() { this.entries = new Map(); }
  async match(key) {
    const bytes = this.entries.get(String(key));
    return bytes ? new Response(bytes) : undefined;
  }
  async put(key, response) {
    this.entries.set(String(key), new Uint8Array(await response.arrayBuffer()));
  }
  async keys() { return [...this.entries.keys()].map((url) => ({ url })); }
  async delete(request) { return this.entries.delete(request.url ?? String(request)); }
}

class FakeCacheStorage {
  constructor(names = []) { this.caches = new Map(names.map((name) => [name, new FakeCache()])); }
  async open(name) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache());
    return this.caches.get(name);
  }
  async keys() { return [...this.caches.keys()]; }
  async delete(name) { return this.caches.delete(name); }
}

function countingFetch(bytes = new Uint8Array([0x1f, 0x8b, 1, 2, 3])) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(bytes);
  };
  return { calls, fetchImpl };
}

test("model parts are fetched once and then served from Cache Storage", async () => {
  const model = getAIModel("b18");
  const cache = await openModelCache(new FakeCacheStorage());
  const { calls, fetchImpl } = countingFetch();
  const first = await loadModelPart(model, model.parts[0], { cache, fetchImpl, baseUrl: BASE });
  const second = await loadModelPart(model, model.parts[0], { cache, fetchImpl, baseUrl: BASE });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://baduk.example/models/katago-b18c384.part01.bin");
  assert.equal(calls[0].init.cache, "force-cache");
  assert.deepEqual([first.cached, second.cached], [false, true]);
  assert.deepEqual(second.bytes, first.bytes);
});

test("cache keys are versioned and a new version replaces the old entry", async () => {
  const cache = await openModelCache(new FakeCacheStorage());
  const oldModel = { ...getAIModel("b10"), compressedBytes: 1 };
  const model = getAIModel("b10");
  assert.notEqual(modelCacheKey(oldModel, model.parts[0], BASE), modelCacheKey(model, model.parts[0], BASE));
  assert.match(modelCacheKey(model, model.parts[0], BASE), /katago-model=b10-11138361$/u);
  const { fetchImpl } = countingFetch();
  await loadModelPart(oldModel, model.parts[0], { cache, fetchImpl, baseUrl: BASE });
  await loadModelPart(model, model.parts[0], { cache, fetchImpl, baseUrl: BASE });
  assert.deepEqual([...cache.entries.keys()], [modelCacheKey(model, model.parts[0], BASE)]);
  await purgeModel(cache, model, BASE);
  assert.equal(cache.entries.size, 0);
});

test("older cache schemas are dropped and missing Cache Storage falls back to the network", async () => {
  const storage = new FakeCacheStorage(["3d-baduk-katago-models-v0", "unrelated"]);
  await openModelCache(storage);
  assert.deepEqual((await storage.keys()).sort(), [MODEL_CACHE_NAME, "unrelated"].sort());

  assert.equal(await openModelCache(undefined), null);
  const blocked = { keys: async () => [], open: async () => { throw new Error("SecurityError"); } };
  assert.equal(await openModelCache(blocked), null);
  const model = getAIModel("b10");
  const { calls, fetchImpl } = countingFetch();
  await loadModelPart(model, model.parts[0], { cache: null, fetchImpl, baseUrl: BASE });
  await loadModelPart(model, model.parts[0], { cache: null, fetchImpl, baseUrl: BASE });
  assert.equal(calls.length, 2);
});

test("a full cache or a failed download never stores a bad entry", async () => {
  const model = getAIModel("b10");
  const cache = await openModelCache(new FakeCacheStorage());
  cache.put = async () => { throw new Error("QuotaExceededError"); };
  const { fetchImpl } = countingFetch();
  const result = await loadModelPart(model, model.parts[0], { cache, fetchImpl, baseUrl: BASE });
  assert.equal(result.cached, false);

  const working = await openModelCache(new FakeCacheStorage());
  await assert.rejects(
    loadModelPart(model, model.parts[0], {
      cache: working,
      fetchImpl: async () => new Response("missing", { status: 404 }),
      baseUrl: BASE,
    }),
    /download failed \(404\)/u,
  );
  assert.equal(working.entries.size, 0);
});

test("the worker loads parts through the cache and retries corrupt cached data", () => {
  const worker = readFileSync(new URL("../src/ai/katagoWorker.js", import.meta.url), "utf8");
  assert.match(worker, /import \{ loadModelPart, openModelCache, purgeModel \} from "\.\/modelCache\.js";/u);
  assert.match(worker, /loadModelPart\(model, part, \{ cache, label \}\)/u);
  assert.match(worker, /if \(!error\?\.invalidModelData \|\| !source\.fromCache\) throw error;\s*await purgeModel\(cache, modelSpec\);/u);
  assert.doesNotMatch(worker, /fetch\(model\.parts/u, "model parts must not bypass the cache");
});
