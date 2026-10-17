import assert from "node:assert/strict";
import test from "node:test";

import { mobiusPointFromCover } from "../src/game/mobiusTopology.js";
import {
  flatBoardLayout,
  flatRowLabel,
  mobiusRowLabelsForCopy,
  mobiusWindowBands,
  mobiusWindowCopies,
} from "../src/view/flatBoardLayout.js";

const SIZES = [
  [9, 9],
  [19, 19],
  [25, 9],
  [7, 15],
];
// Stage sizes and floating-control insets measured at 1440x900 and 390x844.
const VIEWPORTS = [
  { name: "desktop", viewportWidth: 1048, viewportHeight: 826, insets: { top: 60, bottom: 52 } },
  { name: "phone", viewportWidth: 390, viewportHeight: 523, insets: { top: 50, bottom: 42 } },
];
const TOPOLOGIES = [
  { name: "cylinder", torus: false },
  { name: "torus", torus: true },
  { name: "mobius", torus: false },
];

test("row labels count down from the top for square and rectangular boards", () => {
  assert.equal(flatRowLabel(0, 19), "19");
  assert.equal(flatRowLabel(18, 19), "1");
  assert.deepEqual(
    Array.from({ length: 9 }, (_, row) => flatRowLabel(row, 9)),
    ["9", "8", "7", "6", "5", "4", "3", "2", "1"],
  );
  assert.equal(flatRowLabel(0, 15), "15");
  assert.equal(flatRowLabel(14, 15), "1");
});

test("Mobius row labels reverse in every odd copy of the cover", () => {
  assert.deepEqual(mobiusRowLabelsForCopy(0, 5), ["5", "4", "3", "2", "1"]);
  assert.deepEqual(mobiusRowLabelsForCopy(1, 5), ["1", "2", "3", "4", "5"]);
  assert.deepEqual(mobiusRowLabelsForCopy(-1, 5), ["1", "2", "3", "4", "5"]);
  assert.deepEqual(mobiusRowLabelsForCopy(2, 5), ["5", "4", "3", "2", "1"]);
});

test("Mobius window reports the flip seam between differently labelled edges", () => {
  assert.deepEqual(mobiusWindowCopies({ offsetColumns: 0, width: 9 }), {
    leftCopy: 0,
    rightCopy: 0,
    leftFlipped: false,
    rightFlipped: false,
    seam: null,
  });
  // Dragged three columns right: G H J of the flipped copy, then A..F.
  assert.deepEqual(mobiusWindowCopies({ offsetColumns: 3, width: 9 }), {
    leftCopy: -1,
    rightCopy: 0,
    leftFlipped: true,
    rightFlipped: false,
    seam: 3,
  });
  // One full lap: the whole window shows the flipped copy, no inner seam.
  const lap = mobiusWindowCopies({ offsetColumns: 9, width: 9 });
  assert.equal(lap.seam, null);
  assert.equal(lap.leftFlipped, true);
  assert.equal(lap.rightFlipped, true);
  // A lap plus two columns: the seam returns, now with the flip on the right.
  assert.deepEqual(mobiusWindowCopies({ offsetColumns: 11, width: 9 }), {
    leftCopy: -2,
    rightCopy: -1,
    leftFlipped: false,
    rightFlipped: true,
    seam: 2,
  });
});

test("Mobius edge labels match the points drawn in the edge columns", () => {
  for (const [width, height] of [[9, 9], [19, 19], [25, 9], [7, 15]]) {
    for (let step = 0; step < width * 8; step += 1) {
      const offsetColumns = (step / 4) % (width * 2);
      const window = mobiusWindowCopies({ offsetColumns, width });
      const leftLabels = mobiusRowLabelsForCopy(window.leftCopy, height);
      const rightLabels = mobiusRowLabelsForCopy(window.rightCopy, height);
      const leftColumn = Math.round(-offsetColumns);
      const rightColumn = Math.round(width - 1 - offsetColumns);
      for (let visualRow = 0; visualRow < height; visualRow += 1) {
        const left = mobiusPointFromCover(visualRow, leftColumn, width, height);
        const right = mobiusPointFromCover(visualRow, rightColumn, width, height);
        assert.equal(leftLabels[visualRow], String(height - left.row));
        assert.equal(rightLabels[visualRow], String(height - right.row));
      }
      if (window.seam === null) {
        assert.equal(window.leftFlipped, window.rightFlipped);
      } else {
        assert.notEqual(window.leftFlipped, window.rightFlipped);
        assert.ok(window.seam >= 0.5 && window.seam <= width - 0.5);
      }
    }
  }
});

test("Mobius window bands tile the window and alternate orientation", () => {
  for (const width of [5, 9, 19]) {
    for (let step = 0; step < width * 8; step += 1) {
      const offsetColumns = (step * 0.37) % (width * 2);
      const bands = mobiusWindowBands({ offsetColumns, width });
      assert.ok(bands.length === 1 || bands.length === 2);
      assert.equal(bands[0].start, 0);
      assert.equal(bands.at(-1).end, width);
      for (let index = 1; index < bands.length; index += 1) {
        assert.equal(bands[index].start, bands[index - 1].end);
        assert.notEqual(bands[index].flipped, bands[index - 1].flipped);
        // Each copy boundary is where cover column copy*width begins.
        assert.ok(
          Math.abs(bands[index].start - (bands[index].copy * width + offsetColumns)) < 1e-9,
        );
      }
    }
  }
});

function textBoxes(layout, { torus, viewportWidth }) {
  const { fonts } = layout;
  const boxes = [
    { name: "top labels", top: layout.topLabelY - fonts.label / 2, bottom: layout.topLabelY + fonts.label / 2 },
    { name: "bottom labels", top: layout.bottomLabelY - fonts.label / 2, bottom: layout.bottomLabelY + fonts.label / 2 },
  ];
  if (viewportWidth >= 560) {
    boxes.push({ name: "caption", top: layout.captionY - fonts.caption / 2, bottom: layout.captionY + fonts.caption / 2 });
  }
  if (torus) {
    boxes.push(
      { name: "top seam", top: layout.topSeamCaptionY - fonts.seamCaption / 2, bottom: layout.topSeamCaptionY + fonts.seamCaption / 2 },
      { name: "bottom seam", top: layout.bottomSeamCaptionY - fonts.seamCaption / 2, bottom: layout.bottomSeamCaptionY + fonts.seamCaption / 2 },
    );
  }
  return boxes;
}

test("flat labels and captions avoid each other, the board and stage controls", () => {
  for (const viewport of VIEWPORTS) {
    for (const [width, height] of SIZES) {
      for (const topology of TOPOLOGIES) {
        const layout = flatBoardLayout({
          ...viewport,
          width,
          height,
          topSeamCaption: topology.torus,
          bottomSeamCaption: topology.torus,
        });
        const label = `${viewport.name} ${width}x${height} ${topology.name}`;
        const boardTop = layout.frameY;
        const boardBottom = layout.frameY + layout.boardHeight;
        assert.ok(layout.insetsHonoured, label);
        assert.ok(layout.frameX >= 0, label);
        assert.ok(layout.frameX + layout.boardWidth <= viewport.viewportWidth, label);

        const boxes = textBoxes(layout, { torus: topology.torus, viewportWidth: viewport.viewportWidth })
          .sort((left, right) => left.top - right.top);
        for (const box of boxes) {
          assert.ok(box.top >= viewport.insets.top, `${label}: ${box.name} under top controls`);
          assert.ok(
            box.bottom <= viewport.viewportHeight - viewport.insets.bottom,
            `${label}: ${box.name} under bottom controls`,
          );
          assert.ok(box.bottom <= boardTop || box.top >= boardBottom, `${label}: ${box.name} on board`);
        }
        for (let index = 1; index < boxes.length; index += 1) {
          assert.ok(
            boxes[index].top >= boxes[index - 1].bottom,
            `${label}: ${boxes[index - 1].name} overlaps ${boxes[index].name}`,
          );
        }

        // Rotated side captions sit fully outside the row labels and canvas.
        const halfCaption = layout.fonts.seamCaption / 2;
        assert.ok(
          layout.leftSideCaptionX + halfCaption <= layout.leftRowLabelX - layout.rowLabelWidth,
          `${label}: left caption overlaps row labels`,
        );
        assert.ok(
          layout.rightSideCaptionX - halfCaption >= layout.rightRowLabelX + layout.rowLabelWidth,
          `${label}: right caption overlaps row labels`,
        );
        assert.ok(layout.leftSideCaptionX - halfCaption >= 0, label);
        assert.ok(layout.rightSideCaptionX + halfCaption <= viewport.viewportWidth, label);
      }
    }
  }
});

test("without overlapping controls a desktop board keeps its previous size", () => {
  for (const [width, height] of SIZES) {
    const layout = flatBoardLayout({
      viewportWidth: 1048,
      viewportHeight: 826,
      width,
      height,
    });
    const previousCell = Math.min((1048 - 144) / width, (826 - 144) / height);
    assert.equal(layout.cell, previousCell);
  }
});

test("a short landscape stage keeps a usable board instead of clearing controls", () => {
  const layout = flatBoardLayout({
    viewportWidth: 844,
    viewportHeight: 242,
    width: 9,
    height: 9,
    insets: { top: 50, bottom: 42 },
  });
  const unobstructed = flatBoardLayout({
    viewportWidth: 844,
    viewportHeight: 242,
    width: 9,
    height: 9,
  });
  assert.equal(layout.insetsHonoured, false);
  assert.equal(layout.cell, unobstructed.cell);
});
