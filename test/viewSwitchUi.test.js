import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const htmlSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

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
