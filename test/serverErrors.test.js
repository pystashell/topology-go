import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  initializeI18n,
  localizedErrorMessage,
  setLocale,
  translateText,
} from "../src/i18n.js";
import {
  GENERIC_SERVER_ERROR,
  SERVER_ERROR_COPY,
  errorCopy,
} from "../src/i18n/serverErrors.js";

const CJK = /[\u3400-\u9fff\uff01-\uff60\u3000-\u303f]/u;
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

function errorCodesIn(path) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^\s*\/\/.*$/gmu, "");
  return [...source.matchAll(/"([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)"/gu)]
    .map((match) => match[1])
    .filter((code) => code.length > 3 && !HTTP_METHODS.has(code));
}

function quietI18n(locale) {
  initializeI18n({
    storage: null,
    languages: [locale],
    document: null,
    observe: false,
  });
}

test("every error code the room, worker and chat emit has client copy", () => {
  const workerFiles = readdirSync(new URL("../worker/", import.meta.url))
    .filter((name) => name.endsWith(".js"))
    .map((name) => `worker/${name}`);
  const codes = new Set([
    ...workerFiles.flatMap(errorCodesIn),
    ...errorCodesIn("src/multiplayer/roomEngine.js"),
    ...errorCodesIn("src/multiplayer/chat.js"),
    "RATE_LIMITED",
  ]);
  assert.ok(codes.size > 40, "the scan should find the server's error codes");
  const missing = [...codes].filter((code) => !SERVER_ERROR_COPY[code]).sort();
  assert.deepEqual(missing, [], `add client copy for: ${missing.join(", ")}`);
});

test("every coded error and the generic fallback read cleanly in English", () => {
  for (const [code, source] of Object.entries({ ...SERVER_ERROR_COPY, GENERIC: GENERIC_SERVER_ERROR })) {
    const english = translateText(source, {}, "en");
    assert.doesNotMatch(english, CJK, `${code}: ${source} -> ${english}`);
  }
});

test("Chinese keeps the server wording while English falls back by code", () => {
  const unknownSentence = { message: "服务器换了一种说法。", code: "RATE_LIMITED" };
  assert.equal(errorCopy(unknownSentence, { chinese: true }), "服务器换了一种说法。");
  assert.equal(
    translateText(errorCopy(unknownSentence), {}, "en"),
    "Too many requests. Wait a minute and try again.",
  );
  assert.equal(
    errorCopy({ message: "另一个限流", code: "LOBBY_READ_RATE_LIMITED" }),
    SERVER_ERROR_COPY.RATE_LIMITED,
    "any *_RATE_LIMITED code reads as a rate limit",
  );
  assert.equal(errorCopy({ message: "完全未知", code: "SOMETHING_NEW" }), GENERIC_SERVER_ERROR);
  assert.equal(errorCopy({ message: "Failed to fetch" }), "Failed to fetch");
  assert.equal(errorCopy(null, { fallback: "加入房间失败。" }), "加入房间失败。");
});

test("the UI helper follows the active locale", () => {
  quietI18n("en-US");
  const error = { message: "某个尚未翻译的服务器句子。", code: "SPECTATOR_FULL" };
  assert.equal(translateText(localizedErrorMessage(error)), "This room has no spectator places left.");
  setLocale("zh-CN", { persist: false });
  assert.equal(localizedErrorMessage(error), "某个尚未翻译的服务器句子。");
  setLocale("en", { persist: false });
});

test("main.js shows room, lobby and chat errors through the localized helper", () => {
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /const message = localizedErrorMessage\(error\);\s*if \(elements\.onlineDialog\.open\) showOnlineError\(message\);/u);
  assert.match(main, /setMessage\(localizedErrorMessage\(error, "房间拒绝了这个操作。"\), true\)/u);
  assert.match(main, /lobbyStatus\.textContent = localizedErrorMessage\(error, "暂时无法读取在线大厅。"\)/u);
  assert.match(main, /setChatStatus\(localizedErrorMessage\(error, "消息发送失败，请稍后重试。"\), true\)/u);
  assert.doesNotMatch(main, /(?:setMessage|showOnlineError|setChatStatus)\(error\.message/u);
});
