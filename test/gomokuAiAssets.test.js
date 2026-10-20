import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

import { RAPFI_COMMIT, RAPFI_NETWORKS } from "../src/ai/gomoku/rapfiBridge.js";

// The shipped Rapfi build: files, GPL paperwork and the worker's CSP.

const engineDir = new URL("../public/engines/rapfi/", import.meta.url);
const read = (name) => readFileSync(new URL(name, engineDir), "utf8");

test("engine, networks and GPL-3 source paperwork ship together", () => {
  for (const network of Object.values(RAPFI_NETWORKS)) {
    for (const { file, bytes } of network.files) {
      assert.equal(statSync(new URL(file, engineDir)).size, bytes, file);
    }
  }
  for (const file of ["rapfi-single-simd128.mjs", "rapfi-single-simd128.wasm", "model210901.bin",
    `rapfi-source-${RAPFI_COMMIT.slice(0, 7)}.tar.gz`, "build-rapfi.sh"]) {
    assert.ok(statSync(new URL(file, engineDir)).size > 0, file);
  }
  assert.match(read("COPYING"), /GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/u);
  assert.match(read("NETWORKS_LICENSE.txt"), /CC0 1\.0 Universal/u);
  const source = read("SOURCE.md");
  assert.ok(source.includes(`https://github.com/dhbloo/rapfi/tree/${RAPFI_COMMIT}`));
  assert.match(source, /No modifications/u);
  const script = readFileSync(new URL("../scripts/build-rapfi.sh", import.meta.url), "utf8");
  assert.ok(script.includes(`RAPFI_COMMIT="${RAPFI_COMMIT}"`));
  assert.equal(read("build-rapfi.sh"), script, "the served build script is the repository's");
  const notices = readFileSync(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url), "utf8");
  assert.ok(notices.includes(RAPFI_COMMIT));
});

test("the Emscripten glue needs no JS eval", () => {
  const glue = read("rapfi-single-simd128.mjs");
  assert.equal(/\beval\s*\(|new\s+Function\b|\bFunction\s*\(/u.test(glue), false);
  assert.match(glue, /export default Rapfi/u);
});

test("only the Gomoku and KataGo workers may compile WebAssembly", () => {
  const rules = [];
  for (const raw of readFileSync(new URL("../public/_headers", import.meta.url), "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("/")) rules.push({ path: line, set: {}, unset: [] });
    else if (line.startsWith("! ")) rules.at(-1).unset.push(line.slice(2).toLowerCase());
    else {
      const colon = line.indexOf(":");
      rules.at(-1).set[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
  }
  const policy = (text) => Object.fromEntries(text.split(";").map((part) => {
    const [name, ...values] = part.trim().split(/\s+/u);
    return [name, values];
  }));
  const page = policy(rules.find((rule) => rule.path === "/*").set["content-security-policy"]);
  const gomoku = rules.find((rule) => rule.path === "/assets/gomokuAiWorker-*");
  assert.ok(gomoku, "a rule for the built Gomoku worker");
  assert.deepEqual(gomoku.unset, ["content-security-policy"]);
  const workerPolicy = policy(gomoku.set["content-security-policy"]);
  assert.deepEqual(workerPolicy["script-src"], ["'self'", "'wasm-unsafe-eval'"]);
  assert.deepEqual({ ...workerPolicy, "script-src": page["script-src"] }, page);
  const granted = rules
    .filter((rule) => (rule.set["content-security-policy"] ?? "").includes("wasm-unsafe-eval"))
    .map((rule) => rule.path)
    .sort();
  assert.deepEqual(granted, ["/assets/gomokuAiWorker-*", "/assets/katagoWorker-*"]);
});
