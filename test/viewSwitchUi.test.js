import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Windows checkouts may use CRLF; the multi-line patterns below expect LF.
const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/gu, "\n");
const htmlSource = readSource("../index.html");
const mainSource = readSource("../src/main.js");

test("view mode controls are scoped to the view switch, not the board stage", () => {
  // The stage keeps data-view-mode for CSS, so an unscoped attribute query
  // would treat every board tap as a view-switch click.
  assert.match(htmlSource, /<section\s+class="board-stage"\s+data-view-mode=/u);
  assert.match(
    mainSource,
    /viewButtons: \[\.\.\.document\.querySelectorAll\("\.view-switch \[data-view-mode\]"\)\]/u,
  );
  assert.doesNotMatch(mainSource, /querySelectorAll\("\[data-view-mode\]"\)/u);

  const switchStart = htmlSource.indexOf('class="view-switch"');
  const switchEnd = htmlSource.indexOf("</div>", switchStart);
  const insideSwitch = htmlSource.slice(switchStart, switchEnd).match(/data-view-mode=/gu) ?? [];
  const everywhere = htmlSource.match(/\sdata-view-mode=/gu) ?? [];
  assert.equal(insideSwitch.length, 3);
  assert.equal(everywhere.length, insideSwitch.length + 1, "only the stage may carry it outside the switch");
});

const styleSource = readSource("../src/styles.css");

test("the gesture hint wraps within the stage instead of overflowing a phone", () => {
  const rule = /\n\.gesture-hint \{([^}]*)\}/u.exec(styleSource)?.[1];
  assert.ok(rule, "expected a .gesture-hint rule");
  assert.doesNotMatch(rule, /white-space:\s*nowrap/u);
  assert.match(rule, /max-width:\s*calc\(100% - 24px\)/u);
  assert.match(rule, /flex-wrap:\s*wrap/u);
  assert.doesNotMatch(rule, /translateX\(-50%\)/u, "a 50% offset halves the width available for wrapping");
});

test("touch screens are told to pinch, not to use a wheel", () => {
  const start = mainSource.indexOf("const viewCopy = activeViewMode === \"flat\"");
  const viewCopy = mainSource.slice(start, mainSource.indexOf("elements.toggleRotation.hidden", start));
  for (const wheel of viewCopy.match(/"[^"]*滚轮缩放"/gu) ?? []) {
    const pinch = wheel.replace("滚轮缩放", "双指缩放");
    assert.ok(
      viewCopy.includes(`finePointer ? ${wheel} : ${pinch}`) ||
        viewCopy.includes(`? ${wheel}\n                : ${pinch}`),
      `${wheel} needs a touch alternative`,
    );
  }
  assert.match(viewCopy, /finePointer \? "滚轮缩放" : "双指缩放"/u);
});
