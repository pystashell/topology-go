import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import worker from "../worker/index.js";

// Minimal reader for the Workers static-assets _headers format.
function headerRules() {
  const source = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
  const rules = [];
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("/")) {
      rules.push({ path: line, set: {}, unset: [] });
    } else if (line.startsWith("! ")) {
      rules.at(-1).unset.push(line.slice(2).toLowerCase());
    } else {
      const separator = line.indexOf(":");
      rules.at(-1).set[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
    }
  }
  return rules;
}

function directives(policy) {
  return Object.fromEntries(policy.split(";").map((part) => {
    const [name, ...values] = part.trim().split(/\s+/u);
    return [name, values];
  }));
}

test("static assets carry security headers and a strict CSP", () => {
  const [all, katagoWorker] = headerRules();
  assert.equal(all.path, "/*");
  assert.equal(all.set["x-content-type-options"], "nosniff");
  assert.equal(all.set["referrer-policy"], "strict-origin-when-cross-origin");
  assert.equal(all.set["x-frame-options"], "DENY");
  assert.match(all.set["permissions-policy"], /camera=\(\)/u);

  const page = directives(all.set["content-security-policy"]);
  assert.deepEqual(page["default-src"], ["'self'"]);
  assert.deepEqual(page["script-src"], ["'self'"]);
  assert.deepEqual(page["style-src"], ["'self'"]);
  assert.deepEqual(page["connect-src"], ["'self'"], "fetches and WebSockets stay same-origin");
  assert.deepEqual(page["object-src"], ["'none'"]);
  assert.deepEqual(page["frame-ancestors"], ["'none'"]);
  assert.equal(all.set["content-security-policy"].includes("unsafe"), false);

  // Only the KataGo worker may compile WebAssembly, and it replaces (not
  // adds to) the page policy so the two are not intersected.
  assert.equal(katagoWorker.path, "/assets/katagoWorker-*");
  assert.deepEqual(katagoWorker.unset, ["content-security-policy"]);
  const workerPolicy = directives(katagoWorker.set["content-security-policy"]);
  assert.deepEqual(workerPolicy["script-src"], ["'self'", "'wasm-unsafe-eval'"]);
  assert.deepEqual(
    { ...workerPolicy, "script-src": page["script-src"] },
    page,
    "the worker policy differs from the page policy only by wasm compilation",
  );
});

test("API JSON responses are not content-sniffed", async () => {
  for (const request of [
    new Request("https://baduk.test/api/rooms/health"),
    new Request("https://baduk.test/api/rooms", { method: "POST", body: "{" }),
    new Request("https://baduk.test/api/rooms/nope"),
  ]) {
    const response = await worker.fetch(request, {});
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.match(response.headers.get("Content-Type"), /application\/json/u);
  }
});
