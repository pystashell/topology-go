import { mobiusCopyIndex, mobiusRowForCopy } from "../game/mobiusTopology.js";

/**
 * Pure layout and label math for FlatBoard. Everything here works in CSS
 * pixels (or cell units for the Mobius window) so it can be unit tested
 * without a canvas.
 */

export const NARROW_FLAT_VIEWPORT = 560;
const SHORT_FLAT_VIEWPORT = 620;

/** Distance from the board frame to the near edge of a row label. */
export const ROW_LABEL_GAP = 9;
/** Distance from the board frame to the centre of the top column labels. */
export const TOP_COLUMN_LABEL_OFFSET = 10;
/** Distance from the board frame to the centre of the bottom column labels. */
export const BOTTOM_COLUMN_LABEL_OFFSET = 11;
const SIDE_CAPTION_GAP = 6;
const TEXT_LINE_GAP = 5;
const CAPTION_GAP = 7;
const EDGE_MARGIN = 4;
/**
 * Keeping the floating stage controls clear is worth some board size, but a
 * short landscape stage should not shrink the board to an unusable size.
 */
const MIN_INSET_CELL_RATIO = 0.75;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

export function flatLabelFontSize(cell) {
  return clamp(cell * 0.24, 8, 11);
}

export function flatCaptionFontSize(cell) {
  return clamp(cell * 0.3, 10, 13);
}

export function flatSeamCaptionFontSize(cell) {
  return clamp(flatCaptionFontSize(cell) * 0.9, 9, 11);
}

/** Go-style row number: the top row of an H-row board is H, the bottom 1. */
export function flatRowLabel(row, height) {
  return String(height - row);
}

/**
 * Which copies of the Mobius cover the visible window shows.
 *
 * FlatBoard draws cover column c centred at (c + offsetColumns + 0.5) cells
 * from the frame's left edge. Each run of `width` cover columns is one copy
 * of the board; odd copies are vertically flipped. Edge row labels follow the
 * column nearest each edge, so the left and right labels can belong to
 * different copies. `seam` is then the flip boundary between them, in cells
 * from the left frame edge (always within [0.5, width - 0.5]).
 */
export function mobiusWindowCopies({ offsetColumns, width }) {
  // `|| 0` folds -0 into 0 so copy indices compare and serialise cleanly.
  const leftCopy = mobiusCopyIndex(Math.round(-offsetColumns) || 0, width);
  const rightCopy = mobiusCopyIndex(
    Math.round(width - 1 - offsetColumns) || 0,
    width,
  );
  return {
    leftCopy,
    rightCopy,
    leftFlipped: mod(leftCopy, 2) === 1,
    rightFlipped: mod(rightCopy, 2) === 1,
    seam: leftCopy === rightCopy ? null : rightCopy * width + offsetColumns,
  };
}

/**
 * Exact copy bands of the Mobius cover inside the window, in cells from the
 * left frame edge. Used for drawing the flip seam and flipped-copy tint so
 * they slide continuously while the board is dragged.
 */
export function mobiusWindowBands({ offsetColumns, width }) {
  const bands = [];
  const firstCopy = Math.floor(-offsetColumns / width) - 1;
  for (let copy = firstCopy; copy <= firstCopy + 3; copy += 1) {
    const start = Math.max(0, copy * width + offsetColumns);
    const end = Math.min(width, (copy + 1) * width + offsetColumns);
    if (end - start > 1e-6) {
      bands.push({ copy, start, end, flipped: mod(copy, 2) === 1 });
    }
  }
  return bands;
}

/** Row labels, top to bottom, for one copy of the Mobius cover. */
export function mobiusRowLabelsForCopy(copyIndex, height) {
  return Array.from({ length: height }, (_, visualRow) =>
    flatRowLabel(mobiusRowForCopy(visualRow, copyIndex, height), height),
  );
}

function estimateTextWidth(text, fontSize) {
  return String(text).length * fontSize * 0.62;
}

function bandsForCell(cell, options) {
  const {
    height,
    topCaption,
    topSeamCaption,
    bottomSeamCaption,
    sideCaptions,
    measureText,
  } = options;
  const labelFont = flatLabelFontSize(cell);
  const captionFont = flatCaptionFontSize(cell);
  const seamFont = flatSeamCaptionFontSize(cell);
  const rowLabelWidth = measureText(String(height), labelFont);

  let top = TOP_COLUMN_LABEL_OFFSET + labelFont / 2;
  if (topSeamCaption) top += TEXT_LINE_GAP + seamFont;
  if (topCaption) top += CAPTION_GAP + captionFont;
  top += EDGE_MARGIN;

  let bottom = BOTTOM_COLUMN_LABEL_OFFSET + labelFont / 2;
  if (bottomSeamCaption) bottom += TEXT_LINE_GAP + seamFont;
  bottom += EDGE_MARGIN;

  let side = ROW_LABEL_GAP + rowLabelWidth;
  if (sideCaptions) side += SIDE_CAPTION_GAP + seamFont;
  side += EDGE_MARGIN;

  return { top, bottom, side, labelFont, captionFont, seamFont, rowLabelWidth };
}

function cellFor(viewportWidth, viewportHeight, width, height, margins) {
  return Math.max(
    8,
    Math.min(
      (viewportWidth - margins.side * 2) / width,
      (viewportHeight - margins.top - margins.bottom) / height,
    ),
  );
}

/**
 * Size and place the flat board so that its labels and captions never overlap
 * each other, the board itself, or the floating stage controls described by
 * `insets` (pixels covered at the top and bottom of the viewport).
 */
export function flatBoardLayout({
  viewportWidth,
  viewportHeight,
  width,
  height,
  insets = {},
  topCaption = viewportWidth >= NARROW_FLAT_VIEWPORT,
  topSeamCaption = false,
  bottomSeamCaption = false,
  sideCaptions = true,
  measureText = estimateTextWidth,
}) {
  const basePadding = {
    side: viewportWidth < NARROW_FLAT_VIEWPORT ? 36 : 72,
    vertical: viewportHeight < SHORT_FLAT_VIEWPORT ? 54 : 72,
  };
  const options = {
    height,
    topCaption,
    topSeamCaption,
    bottomSeamCaption,
    sideCaptions,
    measureText,
  };
  const marginsFor = (bands, useInsets) => ({
    side: Math.max(basePadding.side, bands.side),
    top: Math.max(
      basePadding.vertical,
      (useInsets ? insets.top ?? 0 : 0) + bands.top,
    ),
    bottom: Math.max(
      basePadding.vertical,
      (useInsets ? insets.bottom ?? 0 : 0) + bands.bottom,
    ),
  });
  const solve = (useInsets) => {
    // Font sizes grow with the cell, so bands measured for the first estimate
    // are an upper bound for the (never larger) final cell.
    const estimate = cellFor(
      viewportWidth,
      viewportHeight,
      width,
      height,
      marginsFor(bandsForCell(Infinity, options), false),
    );
    const bands = bandsForCell(estimate, options);
    const margins = marginsFor(bands, useInsets);
    return {
      cell: cellFor(viewportWidth, viewportHeight, width, height, margins),
      margins,
    };
  };

  const clear = solve(true);
  const insetsHonoured =
    clear.cell >= solve(false).cell * MIN_INSET_CELL_RATIO;
  const { cell, margins } = insetsHonoured ? clear : solve(false);
  const bands = bandsForCell(cell, options);

  const boardWidth = cell * width;
  const boardHeight = cell * height;
  const frameX = (viewportWidth - boardWidth) / 2;
  const centredY = (viewportHeight - boardHeight) / 2;
  const lowestY = viewportHeight - margins.bottom - boardHeight;
  const frameY = Math.max(margins.top, Math.min(centredY, lowestY));

  const topLabelY = frameY - TOP_COLUMN_LABEL_OFFSET;
  const bottomLabelY = frameY + boardHeight + BOTTOM_COLUMN_LABEL_OFFSET;
  const topSeamCaptionY = topSeamCaption
    ? topLabelY - bands.labelFont / 2 - TEXT_LINE_GAP - bands.seamFont / 2
    : null;
  const captionAnchorY = topSeamCaption
    ? topSeamCaptionY - bands.seamFont / 2
    : topLabelY - bands.labelFont / 2;
  const sideCaptionInset =
    ROW_LABEL_GAP + bands.rowLabelWidth + SIDE_CAPTION_GAP + bands.seamFont / 2;

  return {
    cell,
    boardWidth,
    boardHeight,
    frameX,
    frameY,
    insetsHonoured,
    fonts: {
      label: bands.labelFont,
      caption: bands.captionFont,
      seamCaption: bands.seamFont,
    },
    rowLabelWidth: bands.rowLabelWidth,
    topLabelY,
    bottomLabelY,
    captionY: topCaption
      ? captionAnchorY - CAPTION_GAP - bands.captionFont / 2
      : null,
    topSeamCaptionY,
    bottomSeamCaptionY: bottomSeamCaption
      ? bottomLabelY + bands.labelFont / 2 + TEXT_LINE_GAP + bands.seamFont / 2
      : null,
    leftRowLabelX: frameX - ROW_LABEL_GAP,
    rightRowLabelX: frameX + boardWidth + ROW_LABEL_GAP,
    leftSideCaptionX: sideCaptions ? frameX - sideCaptionInset : null,
    rightSideCaptionX: sideCaptions
      ? frameX + boardWidth + sideCaptionInset
      : null,
  };
}
