import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const htmlSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

function elementMarkup(id) {
  const match = new RegExp(`<button\\b([^>]*\\bid="${id}"[^>]*)>([\\s\\S]*?)<\\/button>`).exec(
    htmlSource,
  );
  assert.ok(match, `expected #${id} button to exist`);
  return { attributes: match[1], label: match[2].replace(/<[^>]*>/g, "").trim() };
}

function classNames(attributes) {
  const match = /\bclass="([^"]*)"/.exec(attributes);
  assert.ok(match, "expected the button to declare CSS classes");
  return new Set(match[1].trim().split(/\s+/));
}

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(styleSource);
  assert.ok(match, `expected a dedicated ${selector} CSS rule`);
  return match[1];
}

test("the online room exit is an explicit, prominent danger action", () => {
  const button = elementMarkup("leave-room");
  const classes = classNames(button.attributes);

  assert.equal(button.label, "退出房间");
  assert.ok(classes.has("danger-button"), "exit should use the shared danger treatment");
  assert.ok(
    classes.has("room-leave-action"),
    "exit should have a room-specific class instead of looking like a generic text link",
  );

  const dedicatedStyle = cssRule(".room-leave-action");
  assert.match(
    dedicatedStyle,
    /(?:min-(?:width|height)|padding|flex)\s*:/,
    "the room-specific style should give the action visible size or layout weight",
  );
  assert.match(
    dedicatedStyle,
    /font-weight\s*:/,
    "the room-specific style should make the exit label visually prominent",
  );
});

test("room exit wording distinguishes a normal leave from disconnected cleanup", () => {
  assert.match(
    mainSource,
    /elements\.leaveRoom\.textContent\s*=\s*canDetachReplaced[\s\S]*?\?\s*"关闭本页联机"[\s\S]*?:\s*canAbandonRoom[\s\S]*?\?\s*"忘记房间"[\s\S]*?:\s*"退出房间"\s*;/,
  );
  assert.match(
    mainSource,
    /translateText\("退出房间会释放你的座位，确定退出吗？"\)/,
    "a connected player should confirm the seat-releasing action",
  );
  assert.match(
    mainSource,
    /当前无法通知服务器释放座位。忘记房间只会清除本机凭据，原座位可能继续保留。确定继续吗？/,
    "when disconnected, the warning must not imply that the server seat was released",
  );
  assert.match(mainSource, /elements\.leaveRoom\.addEventListener\("click", \(\) => void leaveOnlineRoom\(\)\)/);
});
