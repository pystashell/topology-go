import assert from "node:assert/strict";
import test from "node:test";

import { flatBoardLayout, flatRowLabel } from "../src/view/flatBoardLayout.js";

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
