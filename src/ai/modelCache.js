// Persistent storage for KataGo model files. The b18 network is ~93 MB in
// four parts; relying on the HTTP cache alone means a cleared or evicted
// cache downloads it again. Cache Storage keeps the exact bytes under a key
// versioned by model id and size, and falls back to the network whenever the
// API is missing, blocked or out of quota.

export const MODEL_CACHE_NAME = "3d-baduk-katago-models-v1";
const MODEL_CACHE_PREFIX = "3d-baduk-katago-models-";
const VERSION_PARAM = "katago-model";

function modelPartUrl(part, baseUrl) {
  return new URL(part, baseUrl);
}

/** Cache key for one model part: its URL plus the model version it belongs to. */
export function modelCacheKey(model, part, baseUrl) {
  const url = modelPartUrl(part, baseUrl);
  url.searchParams.set(VERSION_PARAM, `${model.id}-${model.compressedBytes}`);
  return url.href;
}

/** Open the model cache, dropping caches left by older schema versions. */
export async function openModelCache(cacheStorage = globalThis.caches) {
  if (!cacheStorage?.open) return null;
  try {
    const names = await cacheStorage.keys?.() ?? [];
    await Promise.all(names
      .filter((name) => name.startsWith(MODEL_CACHE_PREFIX) && name !== MODEL_CACHE_NAME)
      .map((name) => cacheStorage.delete(name).catch(() => false)));
    return await cacheStorage.open(MODEL_CACHE_NAME);
  } catch {
    // Opaque origins, private modes and disabled storage throw here.
    return null;
  }
}

async function cachedBytes(cache, key) {
  if (!cache) return null;
  try {
    const hit = await cache.match(key);
    return hit?.ok ? new Uint8Array(await hit.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

async function storeBytes(cache, key, bytes, baseUrl) {
  if (!cache) return;
  try {
    // Replace any other version of the same file so old models do not
    // linger next to the current one.
    const path = new URL(key).pathname;
    for (const request of await cache.keys()) {
      const url = new URL(request.url ?? request, baseUrl);
      if (url.pathname === path && url.href !== key) await cache.delete(request);
    }
    await cache.put(key, new Response(bytes, {
      headers: { "Content-Type": "application/octet-stream" },
    }));
  } catch {
    // Quota or storage errors only cost a future download.
  }
}

/**
 * Fetch one model part, preferring Cache Storage. Returns the bytes and
 * whether they came from the cache so a caller can purge a bad entry.
 */
export async function loadModelPart(model, part, {
  cache = null,
  fetchImpl = globalThis.fetch,
  baseUrl = globalThis.location?.href ?? "http://localhost/",
  label = `KataGo ${model.shortLabel ?? model.id} model`,
} = {}) {
  const key = modelCacheKey(model, part, baseUrl);
  const hit = await cachedBytes(cache, key);
  if (hit) return { bytes: hit, cached: true };
  const response = await fetchImpl(modelPartUrl(part, baseUrl).href, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`${label} download failed (${response.status})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  await storeBytes(cache, key, bytes, baseUrl);
  return { bytes, cached: false };
}

/** Remove every cached part of a model (all versions). */
export async function purgeModel(cache, model, baseUrl = globalThis.location?.href ?? "http://localhost/") {
  if (!cache) return;
  try {
    const paths = new Set(model.parts.map((part) => modelPartUrl(part, baseUrl).pathname));
    for (const request of await cache.keys()) {
      if (paths.has(new URL(request.url ?? request, baseUrl).pathname)) await cache.delete(request);
    }
  } catch {
    // Nothing else to do: the next load simply misses the cache.
  }
}
