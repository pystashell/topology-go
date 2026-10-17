import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

function phoneMedia() {
  const start = styles.indexOf("@media (max-width: 560px) {");
  assert.ok(start >= 0);
  let depth = 0;
  for (let index = styles.indexOf("{", start); index < styles.length; index += 1) {
    if (styles[index] === "{") depth += 1;
    if (styles[index] === "}" && (depth -= 1) === 0) return styles.slice(start, index);
  }
  throw new Error("unterminated media block");
}

test("phones dock the move status and play buttons to the viewport bottom", () => {
  const phone = phoneMedia();
  const rule = (selector) => {
    const start = phone.indexOf(`${selector} {`);
    const match = start >= 0 ? [null, phone.slice(start, phone.indexOf("}", start))] : null;
    assert.ok(match, `expected ${selector} inside the phone media query`);
    return match[1];
  };
  assert.match(rule(".play-docked #play-controls"), /position: fixed;[\s\S]*bottom: 0;/u);
  assert.match(rule(".play-docked #play-controls"), /grid-auto-flow: column;/u, "one row of buttons");
  assert.match(rule(".play-docked #message"), /position: fixed;[\s\S]*bottom: calc\(60px/u);
  assert.match(rule(".play-docked #play-controls button"), /min-height: 44px;/u);
  assert.match(rule(".play-docked .control-panel"), /padding-bottom:/u, "docked bar must not cover the last panel content");
  assert.match(
    rule(".play-docked .control-panel"),
    /backdrop-filter: none;/u,
    "a filtered ancestor would trap the fixed bar inside the panel",
  );
  assert.doesNotMatch(styles.slice(0, styles.indexOf("@media")), /\.play-docked/u, "desktop layout is unchanged");
});

test("the dock is shown only while this viewer is playing", () => {
  const source = main.slice(main.indexOf("function syncPlayDock()"), main.indexOf("function rememberOfflineGame()"));
  assert.match(main, /syncClockUI\(\);\s*syncPlayDock\(\);\s*\}/u, "updateRoomUI keeps the dock in sync");
  const element = (hidden = false) => ({ hidden });
  const classes = new Set();
  const context = {
    elements: {
      playControls: element(),
      passButton: element(),
      gameScreen: { classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) } },
    },
    replaying: false,
    online: false,
    player: true,
    isReplaying: () => context.replaying,
    isNextGameSetup: () => false,
    hasOnlineSession: () => context.online,
    isOnlinePlayer: () => context.player,
  };
  const syncPlayDock = vm.runInNewContext(`${source}\nsyncPlayDock`, context);
  syncPlayDock();
  assert.equal(classes.has("play-docked"), true);
  context.replaying = true;
  syncPlayDock();
  assert.equal(classes.has("play-docked"), false);
  context.replaying = false;
  context.online = true;
  context.player = false;
  syncPlayDock();
  assert.equal(classes.has("play-docked"), false, "spectators have no moves to make");
  context.player = true;
  context.elements.passButton.hidden = true;
  syncPlayDock();
  assert.equal(classes.has("play-docked"), false, "scoring and finished games keep the normal layout");
});
