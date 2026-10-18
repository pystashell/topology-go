import {
  mobiusPointFromCover,
  mobiusPointInCopy,
} from "../game/mobiusTopology.js";
import { formatGoColumn } from "../game/boardDimensions.js";
import {
  flatBoardLayout,
  flatRowLabel,
  mobiusRowLabelsForCopy,
  mobiusWindowBands,
  mobiusWindowCopies,
} from "./flatBoardLayout.js";
import {
  applyBoardTouchAction,
  boardTouchAction,
  invalidatePendingTapOnAdditionalPointer,
  pointerGestureRoles,
  preventBoardContextMenu,
} from "./pointerGestures.js";
import { translateText } from "../i18n.js";
import {
  TERRITORY_MARKER_STYLES,
  territoryPointsForPosition,
} from "./territoryMarkers.js";
import {
  DISC_STYLE,
  FELT_STYLE,
  boardUsesDiscs,
  boardUsesFelt,
  normalizeBoardStyle,
  starPointsFor,
} from "./boardStyle.js";
import {
  EMPTY_GAME_MARKERS,
  GAME_MARKER_STYLES,
  flipPulseLook,
  flipPulseProgress,
  gameMarkerKey,
  gameMarkerPointsSignature,
  lineSegmentsOnScreen,
  normalizeGameMarkers,
  prefersReducedMotion,
} from "./gameMarkers.js";

const TAU = Math.PI * 2;
const DRAG_THRESHOLD = 6;
const LABEL_COLOR = "rgba(235, 240, 237, 0.54)";
const SEAM_ACCENT = "rgba(230, 185, 105, 0.95)";
// Rows of a vertically flipped copy of the Mobius cover are labelled and
// tinted in this colour so labels on either side of the flip seam are never
// read against the wrong half of the board.
const FLIP_ACCENT = "rgba(140, 186, 255, 0.95)";
const FLIP_LABEL_COLOR = "rgba(150, 192, 255, 0.86)";
const FLIP_TINT = "rgba(64, 104, 196, 0.13)";
// Floating stage chrome the flat board keeps its labels and captions clear of.
const BOARD_OVERLAY_SELECTOR = ".view-switch, .scene-toolbar, .gesture-hint";

function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeTopology(topology) {
  return ["cylinder", "torus", "mobius"].includes(topology)
    ? topology
    : "cylinder";
}

export class FlatBoard {
  constructor(
    container,
    { size, width, height, topology = "cylinder", onPoint, onHover, onPan } = {},
  ) {
    const fallbackDimension = size ?? width ?? height ?? 19;
    const boardWidth = width ?? fallbackDimension;
    const boardHeight = height ?? fallbackDimension;
    this.container = container;
    this.onPoint = onPoint;
    this.onHover = onHover;
    this.onPan = onPan;
    this.width = boardWidth;
    this.height = boardHeight;
    this.size = boardWidth === boardHeight ? boardWidth : undefined;
    this.topology = normalizeTopology(topology);
    this.wrapRows = this.topology === "torus";
    this.isMobius = this.topology === "mobius";
    this.board = [];
    this.currentPlayer = "black";
    this.phase = "play";
    this.lastMove = null;
    this.analysisMove = null;
    this.analysisCandidates = [];
    this.analysisVariation = [];
    this.referencePoint = null;
    this.deadKeys = new Set();
    this.territoryPoints = [];
    this.gameMarkers = EMPTY_GAME_MARKERS;
    this.forbiddenKeys = new Set();
    this.flippedSignature = "";
    this.flipPulseStartedAt = null;
    this.flipPulseFrame = null;
    this.boardStyle = normalizeBoardStyle();
    this.feltPattern = null;
    this.hoveredPoint = null;
    this.offsetColumns = 0;
    this.offsetRows = 0;
    this.pointerState = null;
    this.snapFrame = null;
    this.movePreviewEnabled = true;
    this.active = true;
    this.destroyed = false;

    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute(
      "aria-label",
      translateText(
        "竹筒围棋的平面展开视图。左键点击落子；右键或触屏单指横向拖动改变展开起点。",
      ),
    );
    this.context = this.canvas.getContext("2d");
    this.container.appendChild(this.canvas);

    this.handlePointerDown = (event) => this.pointerDown(event);
    this.handlePointerMove = (event) => this.pointerMove(event);
    this.handlePointerUp = (event) => this.pointerUp(event);
    this.handlePointerCancel = (event) => this.pointerCancel(event);
    this.handleContextMenu = (event) => preventBoardContextMenu(event);
    this.handlePointerLeave = () => {
      if (!this.pointerState) this.setHoveredPoint(null);
    };

    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerup", this.handlePointerUp);
    this.canvas.addEventListener("pointercancel", this.handlePointerCancel);
    this.canvas.addEventListener("pointerleave", this.handlePointerLeave);
    this.canvas.addEventListener("contextmenu", this.handleContextMenu);

    this.observedOverlays = new WeakSet();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.rebuild(boardWidth, boardHeight, this.topology);
  }

  rebuild(width, height = width, topology = this.topology) {
    if (typeof height === "string") {
      topology = height;
      height = width;
    }
    this.width = width;
    this.height = height;
    this.size = width === height ? width : undefined;
    this.topology = normalizeTopology(topology);
    this.wrapRows = this.topology === "torus";
    this.isMobius = this.topology === "mobius";
    this.container.dataset.topology = this.topology;
    applyBoardTouchAction(
      [this.container, this.canvas],
      boardTouchAction({ view: "flat", topology: this.topology }),
    );
    this.updateAriaLabel();
    this.board = Array.from({ length: height }, () => Array(width).fill(null));
    this.currentPlayer = "black";
    this.phase = "play";
    this.lastMove = null;
    this.analysisMove = null;
    this.analysisCandidates = [];
    this.analysisVariation = [];
    this.referencePoint = null;
    this.deadKeys.clear();
    this.territoryPoints = [];
    this.gameMarkers = EMPTY_GAME_MARKERS;
    this.forbiddenKeys = new Set();
    this.flippedSignature = "";
    this.cancelFlipPulse();
    this.offsetColumns = 0;
    this.offsetRows = 0;
    this.hoveredPoint = null;
    this.pointerState = null;
    this.container.classList.remove("dragging");
    this.cancelSnap();
    this.resize();
    this.notifyPan();
  }

  updateAriaLabel() {
    this.canvas.setAttribute(
      "aria-label",
      translateText(
        this.wrapRows
          ? "甜甜圈围棋的平面展开视图。左键点击落子；右键或触屏单指向任意方向拖动改变展开起点。"
          : this.isMobius
            ? "莫比乌斯围棋的平面展开视图。左键点击落子；右键或触屏单指横向滑过一圈后棋盘会上下翻转。"
            : "竹筒围棋的平面展开视图。左键点击落子；右键或触屏单指横向拖动改变展开起点。",
      ),
    );
  }

  refreshLanguage() {
    this.updateAriaLabel();
    if (!this.destroyed) this.draw();
  }

  setPosition({
    board,
    size,
    width,
    height,
    topology,
    currentPlayer,
    phase,
    lastMove,
    deadStones = [],
    territoryRegions = [],
    analysisMove = null,
    analysisCandidates = [],
    analysisVariation = [],
    referencePoint = null,
    gameMarkers = null,
    boardStyle = null,
  }) {
    const nextWidth = width ?? size ?? this.width;
    const nextHeight = height ?? size ?? this.height;
    const nextTopology = topology ?? this.topology;
    if (
      nextWidth !== this.width ||
      nextHeight !== this.height ||
      normalizeTopology(nextTopology) !== this.topology
    ) {
      this.rebuild(nextWidth, nextHeight, nextTopology);
    }
    this.board = board;
    this.currentPlayer = currentPlayer;
    this.phase = phase;
    this.lastMove = lastMove;
    this.analysisMove = analysisMove?.type === "play" ? analysisMove : null;
    this.analysisCandidates = Array.isArray(analysisCandidates)
      ? analysisCandidates.slice(0, 5)
      : [];
    this.analysisVariation = Array.isArray(analysisVariation)
      ? analysisVariation.slice(0, 8)
      : [];
    this.referencePoint =
      Number.isInteger(referencePoint?.row) &&
      Number.isInteger(referencePoint?.col) &&
      referencePoint.row >= 0 &&
      referencePoint.row < this.height &&
      referencePoint.col >= 0 &&
      referencePoint.col < this.width
        ? { row: referencePoint.row, col: referencePoint.col }
        : null;
    this.deadKeys = new Set(deadStones.map(({ row, col }) => `${row},${col}`));
    this.territoryPoints = territoryPointsForPosition({
      territoryRegions,
      phase,
      width: this.width,
      height: this.height,
      board,
      deadStones,
    });
    this.boardStyle = normalizeBoardStyle(boardStyle);
    this.setGameMarkers(gameMarkers, board);
    this.draw();
  }

  setGameMarkers(gameMarkers, board) {
    this.gameMarkers = normalizeGameMarkers(gameMarkers, {
      width: this.width,
      height: this.height,
      board,
    });
    this.forbiddenKeys = new Set(this.gameMarkers.forbidden.map(gameMarkerKey));
    const flippedSignature = gameMarkerPointsSignature(this.gameMarkers.flipped);
    if (flippedSignature !== this.flippedSignature) {
      this.flippedSignature = flippedSignature;
      if (flippedSignature) this.startFlipPulse();
      else this.cancelFlipPulse();
    }
  }

  /** A short pulse on newly flipped discs; frames stop when it ends. */
  startFlipPulse() {
    this.cancelFlipPulse();
    if (!this.active || prefersReducedMotion()) return;
    this.flipPulseStartedAt = performance.now();
    const step = (now) => {
      this.flipPulseFrame = null;
      if (flipPulseProgress(this.flipPulseStartedAt, now) === null) {
        this.flipPulseStartedAt = null;
      }
      this.draw();
      if (this.flipPulseStartedAt !== null) {
        this.flipPulseFrame = requestAnimationFrame(step);
      }
    };
    this.flipPulseFrame = requestAnimationFrame(step);
  }

  cancelFlipPulse() {
    if (this.flipPulseFrame !== null) cancelAnimationFrame(this.flipPulseFrame);
    this.flipPulseFrame = null;
    this.flipPulseStartedAt = null;
  }

  isForbiddenPoint(point) {
    return Boolean(point) && this.forbiddenKeys.has(gameMarkerKey(point));
  }

  setActive(active) {
    this.active = active;
    if (active) {
      this.resize();
      this.draw();
    } else {
      this.pointerState = null;
      this.container.classList.remove("dragging");
      this.setHoveredPoint(null);
      this.cancelSnap();
      this.cancelFlipPulse();
    }
  }

  setMovePreviewEnabled(enabled) {
    const next = Boolean(enabled);
    if (this.movePreviewEnabled === next) return;
    this.movePreviewEnabled = next;
    this.draw();
  }

  resetView() {
    this.animateOffsetTo(0, 0);
  }

  horizontalPeriod() {
    return this.isMobius ? this.width * 2 : this.width;
  }

  focusPoint(point) {
    if (
      !Number.isInteger(point?.row) ||
      !Number.isInteger(point?.col) ||
      point.row < 0 ||
      point.row >= this.height ||
      point.col < 0 ||
      point.col >= this.width
    ) {
      return;
    }
    const centeredColumnOffset = (this.width - 1) / 2;
    const centeredRowOffset = (this.height - 1) / 2;
    let targetColumns = centeredColumnOffset - point.col;
    if (this.isMobius) {
      const candidates = [];
      for (let copy = -2; copy <= 3; copy += 1) {
        candidates.push(targetColumns + copy * this.width);
      }
      targetColumns = candidates.reduce((nearest, candidate) =>
        Math.abs(candidate - this.offsetColumns) <
        Math.abs(nearest - this.offsetColumns)
          ? candidate
          : nearest,
      );
    }
    this.animateOffsetTo(
      targetColumns,
      this.wrapRows ? centeredRowOffset - point.row : 0,
    );
  }

  resize() {
    if (this.destroyed || !this.active) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.layout = flatBoardLayout({
      viewportWidth: width,
      viewportHeight: height,
      width: this.width,
      height: this.height,
      insets: this.measureOverlayInsets(height),
      topSeamCaption: this.wrapRows,
      bottomSeamCaption: this.wrapRows,
      measureText: (text, fontSize) => {
        this.context.font = `500 ${fontSize}px Inter, sans-serif`;
        return this.context.measureText(text).width;
      },
    });
    this.cell = this.layout.cell;
    this.boardPixelsWidth = this.layout.boardWidth;
    this.boardPixelsHeight = this.layout.boardHeight;
    this.frameX = this.layout.frameX;
    this.frameY = this.layout.frameY;
    this.draw();
  }

  /**
   * Height of the floating stage controls (view switch, toolbar, gesture
   * hint) over the top and bottom of this view, so labels can avoid them.
   */
  measureOverlayInsets(viewportHeight) {
    const stage = this.container.parentElement;
    if (!stage?.querySelectorAll) return { top: 0, bottom: 0 };
    const origin = this.container.getBoundingClientRect();
    let top = 0;
    let bottom = 0;
    for (const element of stage.querySelectorAll(BOARD_OVERLAY_SELECTOR)) {
      // Re-observing an element re-fires the observer, so only do it once.
      if (this.resizeObserver && !this.observedOverlays.has(element)) {
        this.observedOverlays.add(element);
        this.resizeObserver.observe(element);
      }
      if (element.closest("[hidden]")) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      const relativeTop = rect.top - origin.top;
      const relativeBottom = rect.bottom - origin.top;
      if (relativeBottom <= 0 || relativeTop >= viewportHeight) continue;
      if (relativeTop + relativeBottom < viewportHeight) {
        top = Math.max(top, relativeBottom);
      } else {
        bottom = Math.max(bottom, viewportHeight - relativeTop);
      }
    }
    return { top, bottom };
  }

  pointX(col) {
    return (
      this.frameX +
      mod(col + this.offsetColumns + 0.5, this.width) * this.cell
    );
  }

  pointY(row) {
    const visualRow = this.wrapRows
      ? mod(row + this.offsetRows + 0.5, this.height)
      : row + 0.5;
    return this.frameY + visualRow * this.cell;
  }

  forEachLogicalPoint(row, col, radius, callback) {
    if (!this.isMobius) {
      this.forEachWrappedPoint(
        this.pointX(col),
        this.pointY(row),
        radius,
        callback,
      );
      return;
    }

    const baseColumn = col + this.offsetColumns;
    const firstCopy = Math.floor((-0.5 - baseColumn) / this.width) - 1;
    for (let copyIndex = firstCopy; copyIndex <= firstCopy + 4; copyIndex += 1) {
      const image = mobiusPointInCopy(
        row,
        col,
        copyIndex,
        this.width,
        this.height,
      );
      const x =
        this.frameX +
        (image.coverColumn + this.offsetColumns + 0.5) * this.cell;
      const y = this.frameY + (image.row + 0.5) * this.cell;
      if (
        x + radius >= this.frameX &&
        x - radius <= this.frameX + this.boardPixelsWidth
      ) {
        callback(x, y, copyIndex);
      }
    }
  }

  hitPoint(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (
      x < this.frameX ||
      x > this.frameX + this.boardPixelsWidth ||
      y < this.frameY ||
      y > this.frameY + this.boardPixelsHeight
    ) {
      return null;
    }

    const visualColumn = (x - this.frameX) / this.cell - 0.5;
    const visualRow = (y - this.frameY) / this.cell - 0.5;
    if (this.isMobius) {
      const coverColumn = Math.round(visualColumn - this.offsetColumns);
      const roundedVisualRow = Math.round(visualRow);
      if (roundedVisualRow < 0 || roundedVisualRow >= this.height) return null;
      const point = mobiusPointFromCover(
        roundedVisualRow,
        coverColumn,
        this.width,
        this.height,
      );
      const nearestX =
        this.frameX +
        (coverColumn + this.offsetColumns + 0.5) * this.cell;
      const nearestY =
        this.frameY + (roundedVisualRow + 0.5) * this.cell;
      if (
        Math.abs(x - nearestX) > this.cell * 0.48 ||
        Math.abs(y - nearestY) > this.cell * 0.48
      ) {
        return null;
      }
      return { row: point.row, col: point.col };
    }
    const logicalColumn = Math.round(visualColumn - this.offsetColumns);
    const col = mod(logicalColumn, this.width);
    const logicalRow = Math.round(
      visualRow - (this.wrapRows ? this.offsetRows : 0),
    );
    const row = this.wrapRows ? mod(logicalRow, this.height) : logicalRow;
    if (!this.wrapRows && (row < 0 || row >= this.height)) return null;

    const nearestX = this.pointX(col);
    const directDistance = Math.abs(x - nearestX);
    const xDistance = Math.min(
      directDistance,
      this.boardPixelsWidth - directDistance,
    );
    const directYDistance = Math.abs(y - this.pointY(row));
    const yDistance = this.wrapRows
      ? Math.min(directYDistance, this.boardPixelsHeight - directYDistance)
      : directYDistance;
    if (xDistance > this.cell * 0.48 || yDistance > this.cell * 0.48) {
      return null;
    }
    return { row, col };
  }

  pointerDown(event) {
    const guardedPointer = invalidatePendingTapOnAdditionalPointer(
      this.pointerState,
      event,
    );
    if (guardedPointer !== this.pointerState) {
      this.pointerState = guardedPointer;
      this.setHoveredPoint(null);
      return;
    }
    const roles = pointerGestureRoles(event);
    if (!this.active || !roles || this.pointerState) {
      return;
    }
    if (event.pointerType === "mouse" && roles.canDrag) event.preventDefault();
    this.cancelSnap();
    this.pointerState = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startColumnOffset: this.offsetColumns,
      startRowOffset: this.offsetRows,
      canDrag: roles.canDrag,
      canPlace: roles.canPlace,
      moved: false,
      cancelClick: false,
    };
    this.canvas.setPointerCapture?.(event.pointerId);
  }

  pointerMove(event) {
    if (!this.active) return;
    const pointer = this.pointerState;
    if (pointer && pointer.id === event.pointerId) {
      const deltaX = event.clientX - pointer.startX;
      const deltaY = event.clientY - pointer.startY;
      if (Math.hypot(deltaX, deltaY) > DRAG_THRESHOLD) {
        pointer.cancelClick = true;
      }
      if (pointer.canDrag && (
        (this.wrapRows && Math.hypot(deltaX, deltaY) > DRAG_THRESHOLD) ||
        (!this.wrapRows &&
          Math.abs(deltaX) > DRAG_THRESHOLD &&
          Math.abs(deltaX) > Math.abs(deltaY))
      )) {
        pointer.moved = true;
      }
      if (pointer.moved) {
        this.container.classList.add("dragging");
        this.offsetColumns = mod(
          pointer.startColumnOffset + deltaX / this.cell,
          this.horizontalPeriod(),
        );
        if (this.wrapRows) {
          this.offsetRows = mod(
            pointer.startRowOffset + deltaY / this.cell,
            this.height,
          );
        }
        this.setHoveredPoint(null);
        this.draw();
        this.notifyPan();
      }
      return;
    }
    this.setHoveredPoint(this.hitPoint(event.clientX, event.clientY));
  }

  pointerUp(event) {
    const pointer = this.pointerState;
    if (!pointer || pointer.id !== event.pointerId) return;
    const deltaX = event.clientX - pointer.startX;
    const deltaY = event.clientY - pointer.startY;
    const crossedThreshold = Math.hypot(deltaX, deltaY) > DRAG_THRESHOLD;
    const horizontalDrag =
      Math.abs(deltaX) > DRAG_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY);
    const moved = pointer.canDrag && (
      pointer.moved || (this.wrapRows ? crossedThreshold : horizontalDrag)
    );
    this.pointerState = null;
    this.container.classList.remove("dragging");
    if (this.canvas.hasPointerCapture?.(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }

    if (moved) {
      if (!pointer.moved) {
        this.offsetColumns = mod(
          pointer.startColumnOffset + deltaX / this.cell,
          this.horizontalPeriod(),
        );
        if (this.wrapRows) {
          this.offsetRows = mod(
            pointer.startRowOffset + deltaY / this.cell,
            this.height,
          );
        }
        this.draw();
        this.notifyPan();
      }
      this.snapToGrid();
      return;
    }
    if (!pointer.canPlace || pointer.cancelClick || crossedThreshold) return;
    const point = this.hitPoint(event.clientX, event.clientY);
    if (point && this.onPoint) this.onPoint(point);
  }

  pointerCancel(event) {
    if (!this.pointerState || this.pointerState.id !== event.pointerId) return;
    this.pointerState = null;
    this.container.classList.remove("dragging");
    this.setHoveredPoint(null);
    this.snapToGrid();
  }

  setHoveredPoint(point) {
    const same =
      point?.row === this.hoveredPoint?.row &&
      point?.col === this.hoveredPoint?.col;
    if (same) return;
    this.hoveredPoint = point;
    this.draw();
    if (this.onHover) this.onHover(point);
  }

  snapToColumn() {
    this.snapToGrid();
  }

  snapToGrid() {
    this.animateOffsetTo(
      Math.round(this.offsetColumns),
      this.wrapRows ? Math.round(this.offsetRows) : 0,
    );
  }

  animateOffsetTo(targetColumns, targetRows = this.offsetRows) {
    this.cancelSnap();
    const startColumns = this.offsetColumns;
    const startRows = this.offsetRows;
    let adjustedColumns = targetColumns;
    let adjustedRows = this.wrapRows ? targetRows : 0;
    const horizontalPeriod = this.horizontalPeriod();
    while (adjustedColumns - startColumns > horizontalPeriod / 2) {
      adjustedColumns -= horizontalPeriod;
    }
    while (adjustedColumns - startColumns < -horizontalPeriod / 2) {
      adjustedColumns += horizontalPeriod;
    }
    while (adjustedRows - startRows > this.height / 2) adjustedRows -= this.height;
    while (adjustedRows - startRows < -this.height / 2) adjustedRows += this.height;
    const startedAt = performance.now();
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : 180;

    const step = (now) => {
      const progress = duration === 0 ? 1 : Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      this.offsetColumns =
        startColumns + (adjustedColumns - startColumns) * eased;
      this.offsetRows = this.wrapRows
        ? startRows + (adjustedRows - startRows) * eased
        : 0;
      this.draw();
      this.notifyPan();
      if (progress < 1) {
        this.snapFrame = requestAnimationFrame(step);
      } else {
        this.offsetColumns = mod(adjustedColumns, horizontalPeriod);
        this.offsetRows = this.wrapRows ? mod(adjustedRows, this.height) : 0;
        this.snapFrame = null;
        this.draw();
        this.notifyPan();
      }
    };
    this.snapFrame = requestAnimationFrame(step);
  }

  cancelSnap() {
    if (this.snapFrame !== null) cancelAnimationFrame(this.snapFrame);
    this.snapFrame = null;
  }

  notifyPan() {
    if (!this.onPan) return;
    const startCol = mod(-Math.round(this.offsetColumns), this.width);
    const startRow = this.wrapRows
      ? mod(-Math.round(this.offsetRows), this.height)
      : 0;
    const flipped = this.isMobius &&
      mod(
        mobiusPointFromCover(
          0,
          -Math.round(this.offsetColumns),
          this.width,
          this.height,
        ).copyIndex,
        2,
      ) === 1;
    this.onPan({
      startCol,
      startRow,
      flipped,
      offsetColumns: this.offsetColumns,
      offsetRows: this.offsetRows,
    });
  }

  draw() {
    if (!this.active || !this.context || !this.cell) return;
    const context = this.context;
    context.clearRect(0, 0, this.viewportWidth, this.viewportHeight);

    this.drawBoardSurface(context);
    this.drawMobiusFlipTint(context);
    this.drawGrid(context);
    this.drawStarPoints(context);
    this.drawTerritory(context);
    this.drawPointMarkers(context);
    this.drawStones(context);
    this.drawStoneMarkers(context);
    this.drawHover(context);
    this.drawAnalysisCandidates(context);
    this.drawAnalysisMove(context);
    this.drawAnalysisVariation(context);
    this.drawReferencePoint(context);
    this.drawSeam(context);
    this.drawColumnLabels(context);
  }

  drawBoardSurface(context) {
    const felt = boardUsesFelt(this.boardStyle);
    context.save();
    context.shadowColor = "rgba(0, 0, 0, 0.34)";
    context.shadowBlur = 26;
    context.shadowOffsetY = 12;
    const gradient = context.createLinearGradient(
      this.frameX,
      this.frameY,
      this.frameX + this.boardPixelsWidth,
      this.frameY + this.boardPixelsHeight,
    );
    if (felt) {
      const [start, middle, end] = FELT_STYLE.flatGradient;
      gradient.addColorStop(0, start);
      gradient.addColorStop(0.5, middle);
      gradient.addColorStop(1, end);
    } else {
      gradient.addColorStop(0, "#d19a56");
      gradient.addColorStop(0.5, "#b97c3b");
      gradient.addColorStop(1, "#9a5f2e");
    }
    context.fillStyle = gradient;
    context.fillRect(
      this.frameX,
      this.frameY,
      this.boardPixelsWidth,
      this.boardPixelsHeight,
    );
    context.restore();

    if (felt) {
      this.drawFeltNap(context);
      return;
    }

    context.save();
    context.beginPath();
    context.rect(
      this.frameX,
      this.frameY,
      this.boardPixelsWidth,
      this.boardPixelsHeight,
    );
    context.clip();
    context.globalAlpha = 0.1;
    context.lineWidth = 1;
    for (
      let grain = -this.boardPixelsWidth;
      grain < this.boardPixelsWidth * 2;
      grain += 17
    ) {
      context.beginPath();
      context.moveTo(this.frameX + grain, this.frameY);
      for (let y = this.frameY; y <= this.frameY + this.boardPixelsHeight; y += 18) {
        const wave = Math.sin((y + grain) * 0.035) * 5;
        context.lineTo(this.frameX + grain + wave + (y - this.frameY) * 0.2, y);
      }
      context.strokeStyle = grain % 34 === 0 ? "#4b2814" : "#f3ca86";
      context.stroke();
    }
    context.restore();
  }

  /** Fine speckle over the felt, from a small cached repeating tile. */
  drawFeltNap(context) {
    if (!this.feltPattern) {
      const tile = document.createElement("canvas");
      tile.width = 96;
      tile.height = 96;
      const tileContext = tile.getContext("2d");
      let seed = 0x0f17;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      for (let index = 0; index < 900; index += 1) {
        tileContext.fillStyle =
          random() < 0.55 ? FELT_STYLE.flatSpeckleDark : FELT_STYLE.flatSpeckleLight;
        tileContext.fillRect(random() * 96, random() * 96, 1.2, 1.2);
      }
      this.feltPattern = context.createPattern(tile, "repeat");
    }
    if (!this.feltPattern) return;
    context.save();
    context.fillStyle = this.feltPattern;
    context.fillRect(
      this.frameX,
      this.frameY,
      this.boardPixelsWidth,
      this.boardPixelsHeight,
    );
    context.restore();
  }

  drawGrid(context) {
    context.save();
    context.beginPath();
    context.rect(
      this.frameX,
      this.frameY,
      this.boardPixelsWidth,
      this.boardPixelsHeight,
    );
    context.clip();
    context.strokeStyle = boardUsesFelt(this.boardStyle)
      ? FELT_STYLE.flatGrid
      : "rgba(39, 25, 17, 0.88)";
    context.lineWidth = clamp(this.cell * 0.035, 0.8, 1.45);

    for (let row = 0; row < this.height; row += 1) {
      const y = this.pointY(row);
      context.beginPath();
      context.moveTo(this.frameX, y);
      context.lineTo(this.frameX + this.boardPixelsWidth, y);
      context.stroke();
    }

    for (let col = 0; col < this.width; col += 1) {
      const x = this.pointX(col);
      context.beginPath();
      context.moveTo(x, this.wrapRows ? this.frameY : this.pointY(0));
      context.lineTo(
        x,
        this.wrapRows
          ? this.frameY + this.boardPixelsHeight
          : this.pointY(this.height - 1),
      );
      context.stroke();
    }
    context.restore();
  }

  drawStarPoints(context) {
    const stars = starPointsFor({
      width: this.width,
      height: this.height,
      gameType: this.boardStyle.gameType,
    });
    if (stars.length === 0) return;
    context.save();
    context.beginPath();
    context.rect(
      this.frameX,
      this.frameY,
      this.boardPixelsWidth,
      this.boardPixelsHeight,
    );
    context.clip();
    context.fillStyle = "#28190f";
    const radius = clamp(this.cell * 0.105, 1.7, 4.2);
    for (const { row, col } of stars) {
      this.forEachLogicalPoint(
        row,
        col,
        radius,
        (x, y) => {
          context.beginPath();
          context.arc(x, y, radius, 0, TAU);
          context.fill();
        },
      );
    }
    context.restore();
  }

  forEachWrappedX(x, radius, callback) {
    for (const shiftedX of [
      x - this.boardPixelsWidth,
      x,
      x + this.boardPixelsWidth,
    ]) {
      if (
        shiftedX + radius >= this.frameX &&
        shiftedX - radius <= this.frameX + this.boardPixelsWidth
      ) {
        callback(shiftedX);
      }
    }
  }

  forEachWrappedPoint(x, y, radius, callback) {
    const yOffsets = this.wrapRows
      ? [-this.boardPixelsHeight, 0, this.boardPixelsHeight]
      : [0];
    for (const shiftedX of [
      x - this.boardPixelsWidth,
      x,
      x + this.boardPixelsWidth,
    ]) {
      if (
        shiftedX + radius < this.frameX ||
        shiftedX - radius > this.frameX + this.boardPixelsWidth
      ) {
        continue;
      }
      for (const yOffset of yOffsets) {
        const shiftedY = y + yOffset;
        if (
          !this.wrapRows ||
          (shiftedY + radius >= this.frameY &&
            shiftedY - radius <= this.frameY + this.boardPixelsHeight)
        ) {
          callback(shiftedX, shiftedY);
        }
      }
    }
  }

  drawTerritory(context) {
    if (this.territoryPoints.length === 0) return;
    const radius = clamp(this.cell * 0.19, 2.6, 7.2);
    context.save();
    context.beginPath();
    context.rect(
      this.frameX,
      this.frameY,
      this.boardPixelsWidth,
      this.boardPixelsHeight,
    );
    context.clip();
    context.lineJoin = "round";

    for (const { row, col, owner } of this.territoryPoints) {
      const style = TERRITORY_MARKER_STYLES[owner];
      this.forEachLogicalPoint(row, col, radius * 1.4, (x, y) => {
        context.save();
        context.translate(x, y);
        context.rotate(Math.PI / 4);
        context.strokeStyle = style.stroke;
        context.lineWidth = clamp(this.cell * 0.16, 2.2, 5);
        context.strokeRect(-radius, -radius, radius * 2, radius * 2);
        context.strokeStyle = style.fill;
        context.lineWidth = clamp(this.cell * 0.075, 1.2, 2.6);
        context.strokeRect(-radius, -radius, radius * 2, radius * 2);
        context.restore();
      });
    }
    context.restore();
  }

  drawStones(context) {
    if (!this.board?.length) return;
    const radius = this.cell * 0.41;
    context.save();
    context.beginPath();
    context.rect(
      this.frameX,
      this.frameY,
      this.boardPixelsWidth,
      this.boardPixelsHeight,
    );
    context.clip();

    for (let row = 0; row < this.height; row += 1) {
      for (let col = 0; col < this.width; col += 1) {
        const color = this.board[row]?.[col];
        if (!color) continue;
        const dead = this.deadKeys.has(`${row},${col}`);
        this.forEachLogicalPoint(
          row,
          col,
          radius,
          (x, y) => {
            this.drawStone(context, x, y, radius, color, dead);
            if (
              this.lastMove?.type === "play" &&
              this.lastMove.row === row &&
              this.lastMove.col === col
            ) {
              context.beginPath();
              context.arc(x, y, radius * 0.24, 0, TAU);
              context.strokeStyle = "#d9aa58";
              context.lineWidth = Math.max(1.5, radius * 0.11);
              context.stroke();
            }
          },
        );
      }
    }
    context.restore();
  }

  /**
   * Othello legal-move dots and Renju forbidden crosses, both on empty
   * points, drawn under the stone layer.
   */
  drawPointMarkers(context) {
    const { legal, forbidden } = this.gameMarkers;
    if (legal.length === 0 && forbidden.length === 0) return;
    context.save();
    context.beginPath();
    context.rect(
      this.frameX,
      this.frameY,
      this.boardPixelsWidth,
      this.boardPixelsHeight,
    );
    context.clip();

    const dotRadius = clamp(this.cell * 0.12, 2.5, 7);
    context.fillStyle =
      GAME_MARKER_STYLES.legal[this.currentPlayer === "white" ? "white" : "black"].fill;
    for (const { row, col } of legal) {
      this.forEachLogicalPoint(row, col, dotRadius, (x, y) => {
        context.beginPath();
        context.arc(x, y, dotRadius, 0, TAU);
        context.fill();
      });
    }

    const arm = clamp(this.cell * 0.16, 3, 9);
    context.strokeStyle = GAME_MARKER_STYLES.forbidden.stroke;
    context.lineWidth = clamp(this.cell * 0.065, 1.4, 3.2);
    context.lineCap = "round";
    for (const { row, col } of forbidden) {
      this.forEachLogicalPoint(row, col, arm, (x, y) => {
        this.strokeCross(context, x, y, arm);
      });
    }
    context.restore();
  }

  strokeCross(context, x, y, arm) {
    context.beginPath();
    context.moveTo(x - arm, y - arm);
    context.lineTo(x + arm, y + arm);
    context.moveTo(x + arm, y - arm);
    context.lineTo(x - arm, y + arm);
    context.stroke();
  }

  /** Every on-screen image of a point, including those just past an edge. */
  pointImages(row, col, margin) {
    const images = [];
    this.forEachLogicalPoint(row, col, margin, (x, y) => images.push({ x, y }));
    return images;
  }

  /**
   * Flipped-disc outlines (with their brief pulse) and the winning line: a
   * glow ring on each winning stone plus a stroke joining neighbouring
   * stones. The stroke is drawn pair by pair between images that are
   * neighbours on screen, so it stays correct across wrapped edges and the
   * Mobius flip.
   */
  drawStoneMarkers(context) {
    const { winLine, flipped } = this.gameMarkers;
    if (winLine.length === 0 && flipped.length === 0) return;
    const stoneRadius = this.cell * 0.41;
    context.save();
    context.beginPath();
    context.rect(
      this.frameX,
      this.frameY,
      this.boardPixelsWidth,
      this.boardPixelsHeight,
    );
    context.clip();

    if (flipped.length > 0) {
      const style = GAME_MARKER_STYLES.flipped;
      const progress = flipPulseProgress(this.flipPulseStartedAt, performance.now());
      const pulse = progress === null ? null : flipPulseLook(progress);
      const lineWidth = clamp(this.cell * 0.06, 1.5, 3);
      for (const { row, col } of flipped) {
        this.forEachLogicalPoint(row, col, stoneRadius * 1.9, (x, y) => {
          context.strokeStyle = style.stroke;
          context.lineWidth = lineWidth;
          context.beginPath();
          context.arc(x, y, stoneRadius * 1.07, 0, TAU);
          context.stroke();
          if (pulse) {
            context.save();
            context.globalAlpha = pulse.opacity;
            context.strokeStyle = style.pulse;
            context.lineWidth = lineWidth * 1.3;
            context.beginPath();
            context.arc(x, y, stoneRadius * 1.07 * pulse.scale, 0, TAU);
            context.stroke();
            context.restore();
          }
        });
      }
    }

    if (winLine.length > 0) {
      const style = GAME_MARKER_STYLES.win;
      context.save();
      context.shadowColor = style.glow;
      context.shadowBlur = Math.max(4, this.cell * 0.32);
      context.strokeStyle = style.ring;
      context.lineWidth = clamp(this.cell * 0.075, 1.6, 3.4);
      for (const { row, col } of winLine) {
        this.forEachLogicalPoint(row, col, stoneRadius * 1.3, (x, y) => {
          context.beginPath();
          context.arc(x, y, stoneRadius * 1.08, 0, TAU);
          context.stroke();
        });
      }
      // A neighbour across a seam lies at most one cell past the frame.
      const margin = this.cell * 1.05;
      const segments = lineSegmentsOnScreen(
        winLine,
        (row, col) => this.pointImages(row, col, margin),
        { step: this.cell },
      );
      context.strokeStyle = style.stroke;
      context.lineWidth = clamp(this.cell * 0.11, 2, 6);
      context.lineCap = "round";
      for (const { from, to } of segments) {
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.stroke();
      }
      context.restore();
    }
    context.restore();
  }

  drawStone(context, x, y, radius, color, dead) {
    if (!dead && boardUsesDiscs(this.boardStyle)) {
      this.drawDisc(context, x, y, radius, color);
      return;
    }
    context.save();
    context.globalAlpha *= dead ? 0.28 : 1;
    context.shadowColor = dead ? "transparent" : "rgba(0, 0, 0, 0.36)";
    context.shadowBlur = radius * 0.42;
    context.shadowOffsetY = radius * 0.17;
    const gradient = context.createRadialGradient(
      x - radius * 0.34,
      y - radius * 0.38,
      radius * 0.08,
      x,
      y,
      radius,
    );
    if (color === "black") {
      gradient.addColorStop(0, "#555d59");
      gradient.addColorStop(0.35, "#222825");
      gradient.addColorStop(1, "#070a09");
    } else {
      gradient.addColorStop(0, "#ffffff");
      gradient.addColorStop(0.52, "#ece9df");
      gradient.addColorStop(1, "#b8beb9");
    }
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, radius, 0, TAU);
    context.fill();
    context.restore();

    if (dead) {
      context.save();
      context.strokeStyle = "rgba(126, 35, 30, 0.9)";
      context.lineWidth = Math.max(1.5, radius * 0.12);
      const span = radius * 0.48;
      context.beginPath();
      context.moveTo(x - span, y - span);
      context.lineTo(x + span, y + span);
      context.moveTo(x + span, y - span);
      context.lineTo(x - span, y + span);
      context.stroke();
      context.restore();
    }
  }

  /** A flat Othello disc: a darker edge under the face suggests thickness. */
  drawDisc(context, x, y, radius, color) {
    const style = DISC_STYLE[color === "white" ? "white" : "black"];
    context.save();
    context.shadowColor = "rgba(0, 0, 0, 0.34)";
    context.shadowBlur = radius * 0.32;
    context.shadowOffsetY = radius * 0.14;
    context.fillStyle = style.edge;
    context.beginPath();
    context.arc(x, y + radius * 0.05, radius, 0, TAU);
    context.fill();
    context.restore();

    context.save();
    context.fillStyle = style.face;
    context.beginPath();
    context.arc(x, y - radius * 0.03, radius * 0.93, 0, TAU);
    context.fill();
    context.strokeStyle = style.rim;
    context.lineWidth = Math.max(1, radius * 0.07);
    context.beginPath();
    context.arc(x, y - radius * 0.03, radius * 0.7, 0, TAU);
    context.stroke();
    context.restore();
  }

  drawAnalysisMove(context) {
    if (this.analysisCandidates.length > 0) return;
    const move = this.analysisMove;
    if (
      move?.type !== "play" ||
      !Number.isInteger(move.row) ||
      !Number.isInteger(move.col) ||
      move.row < 0 ||
      move.row >= this.height ||
      move.col < 0 ||
      move.col >= this.width ||
      this.board?.[move.row]?.[move.col]
    ) {
      return;
    }

    const radius = clamp(this.cell * 0.29, 5, 14);
    context.save();
    context.beginPath();
    context.rect(
      this.frameX,
      this.frameY,
      this.boardPixelsWidth,
      this.boardPixelsHeight,
    );
    context.clip();
    this.forEachLogicalPoint(
      move.row,
      move.col,
      radius,
      (x, y) => {
        context.save();
        context.shadowColor = "rgba(42, 238, 202, 0.85)";
        context.shadowBlur = Math.max(5, radius * 0.7);
        context.fillStyle = "rgba(38, 214, 184, 0.68)";
        context.strokeStyle = "#72ffe2";
        context.lineWidth = Math.max(1.5, radius * 0.14);
        context.beginPath();
        context.moveTo(x, y - radius);
        context.lineTo(x + radius, y);
        context.lineTo(x, y + radius);
        context.lineTo(x - radius, y);
        context.closePath();
        context.fill();
        context.stroke();

        context.shadowBlur = 0;
        context.fillStyle = "#f3cf78";
        context.beginPath();
        context.arc(x, y, radius * 0.22, 0, TAU);
        context.fill();
        context.restore();
      },
    );
    context.restore();
  }

  drawAnalysisCandidates(context) {
    if (this.analysisCandidates.length === 0) return;
    const palette = ["#3de0c1", "#72a8ff", "#b996ff", "#f0b96c", "#ef7f83"];
    const radius = clamp(this.cell * 0.32, 6, 15);
    context.save();
    context.beginPath();
    context.rect(this.frameX, this.frameY, this.boardPixelsWidth, this.boardPixelsHeight);
    context.clip();
    this.analysisCandidates.forEach((candidate, index) => {
      const move = candidate?.move ?? candidate;
      if (
        move?.type !== "play" ||
        !Number.isInteger(move.row) ||
        !Number.isInteger(move.col) ||
        move.row < 0 || move.row >= this.height ||
        move.col < 0 || move.col >= this.width ||
        this.board?.[move.row]?.[move.col]
      ) return;
      const rank = Number.isSafeInteger(candidate?.rank) ? candidate.rank : index + 1;
      const color = palette[Math.min(index, palette.length - 1)];
      this.forEachLogicalPoint(move.row, move.col, radius, (x, y) => {
        context.save();
        context.shadowColor = color;
        context.shadowBlur = candidate?.active ? radius * 0.9 : radius * 0.38;
        context.globalAlpha = candidate?.active ? 0.98 : 0.82;
        context.fillStyle = color;
        context.beginPath();
        context.arc(x, y, candidate?.active ? radius : radius * 0.88, 0, TAU);
        context.fill();
        context.shadowBlur = 0;
        context.globalAlpha = 1;
        context.fillStyle = "#07110f";
        context.font = `700 ${Math.max(9, radius * 1.05)}px system-ui, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(String(rank), x, y + 0.5);
        context.restore();
      });
    });
    context.restore();
  }

  drawAnalysisVariation(context) {
    if (this.analysisVariation.length === 0) return;
    const radius = clamp(this.cell * 0.25, 5, 12);
    context.save();
    context.beginPath();
    context.rect(this.frameX, this.frameY, this.boardPixelsWidth, this.boardPixelsHeight);
    context.clip();
    this.analysisVariation.forEach((entry, index) => {
      const move = entry?.move ?? entry;
      if (
        move?.type !== "play" ||
        !Number.isInteger(move.row) ||
        !Number.isInteger(move.col) ||
        move.row < 0 || move.row >= this.height ||
        move.col < 0 || move.col >= this.width
      ) return;
      const number = Number.isSafeInteger(entry?.number) ? entry.number : index + 1;
      this.forEachLogicalPoint(move.row, move.col, radius, (x, y) => {
        context.save();
        context.fillStyle = entry?.color === "white" ? "rgba(248, 246, 237, 0.92)" : "rgba(12, 18, 16, 0.9)";
        context.strokeStyle = "#f3cf78";
        context.lineWidth = Math.max(1.5, radius * 0.16);
        context.beginPath();
        context.arc(x, y, radius, 0, TAU);
        context.fill();
        context.stroke();
        context.fillStyle = entry?.color === "white" ? "#151a18" : "#f7f2de";
        context.font = `700 ${Math.max(8, radius * 1.02)}px system-ui, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(String(number), x, y + 0.5);
        context.restore();
      });
    });
    context.restore();
  }

  drawReferencePoint(context) {
    const point = this.referencePoint;
    if (
      !Number.isInteger(point?.row) ||
      !Number.isInteger(point?.col) ||
      point.row < 0 ||
      point.row >= this.height ||
      point.col < 0 ||
      point.col >= this.width
    ) {
      return;
    }

    const radius = clamp(this.cell * 0.34, 6, 17);
    context.save();
    context.beginPath();
    context.rect(
      this.frameX,
      this.frameY,
      this.boardPixelsWidth,
      this.boardPixelsHeight,
    );
    context.clip();
    this.forEachLogicalPoint(
      point.row,
      point.col,
      radius + 3,
      (x, y) => {
        context.save();
        context.shadowColor = "rgba(255, 45, 196, 0.9)";
        context.shadowBlur = Math.max(7, radius * 0.75);
        context.fillStyle = "rgba(196, 33, 153, 0.25)";
        context.strokeStyle = "#ff4dce";
        context.lineWidth = Math.max(2.2, radius * 0.16);
        context.beginPath();
        context.arc(x, y, radius, 0, TAU);
        context.fill();
        context.stroke();

        context.shadowBlur = 0;
        context.strokeStyle = "rgba(255, 219, 248, 0.96)";
        context.lineWidth = Math.max(1.2, radius * 0.09);
        const tickStart = radius * 0.57;
        const tickEnd = radius * 0.92;
        context.beginPath();
        context.moveTo(x - tickEnd, y);
        context.lineTo(x - tickStart, y);
        context.moveTo(x + tickStart, y);
        context.lineTo(x + tickEnd, y);
        context.moveTo(x, y - tickEnd);
        context.lineTo(x, y - tickStart);
        context.moveTo(x, y + tickStart);
        context.lineTo(x, y + tickEnd);
        context.stroke();
        context.restore();
      },
    );
    context.restore();
  }

  drawHover(context) {
    const point = this.hoveredPoint;
    if (
      !this.movePreviewEnabled ||
      this.phase !== "play" ||
      !point ||
      this.board?.[point.row]?.[point.col]
    ) {
      return;
    }
    if (this.isForbiddenPoint(point)) {
      this.drawForbiddenHover(context, point);
      return;
    }
    const radius = this.cell * 0.4;
    context.save();
    context.beginPath();
    context.rect(
      this.frameX,
      this.frameY,
      this.boardPixelsWidth,
      this.boardPixelsHeight,
    );
    context.clip();
    context.globalAlpha = 0.48;
    this.forEachLogicalPoint(
      point.row,
      point.col,
      radius,
      (x, y) => {
        this.drawStone(
          context,
          x,
          y,
          radius,
          this.currentPlayer,
          false,
        );
      },
    );
    context.restore();
  }

  /** Hovering a forbidden point shows a cross instead of a ghost stone. */
  drawForbiddenHover(context, point) {
    const style = GAME_MARKER_STYLES.forbidden;
    const radius = this.cell * 0.36;
    const arm = radius * 0.62;
    context.save();
    context.beginPath();
    context.rect(
      this.frameX,
      this.frameY,
      this.boardPixelsWidth,
      this.boardPixelsHeight,
    );
    context.clip();
    context.lineCap = "round";
    this.forEachLogicalPoint(point.row, point.col, radius, (x, y) => {
      context.fillStyle = style.hoverFill;
      context.beginPath();
      context.arc(x, y, radius, 0, TAU);
      context.fill();
      context.strokeStyle = style.hoverStroke;
      context.lineWidth = clamp(this.cell * 0.1, 2, 4.5);
      this.strokeCross(context, x, y, arm);
    });
    context.restore();
  }

  drawSeam(context) {
    if (this.wrapRows) {
      this.drawTorusSeam(context);
      return;
    }
    if (this.isMobius) {
      this.drawMobiusSeam(context);
      return;
    }
    const left = this.frameX;
    const right = this.frameX + this.boardPixelsWidth;
    const top = this.frameY;
    const bottom = this.frameY + this.boardPixelsHeight;

    context.save();
    const leftGlow = context.createLinearGradient(left, 0, left + 18, 0);
    leftGlow.addColorStop(0, "rgba(230, 185, 105, 0.22)");
    leftGlow.addColorStop(1, "rgba(230, 185, 105, 0)");
    context.fillStyle = leftGlow;
    context.fillRect(left, top, 18, this.boardPixelsHeight);
    const rightGlow = context.createLinearGradient(right - 18, 0, right, 0);
    rightGlow.addColorStop(0, "rgba(230, 185, 105, 0)");
    rightGlow.addColorStop(1, "rgba(230, 185, 105, 0.22)");
    context.fillStyle = rightGlow;
    context.fillRect(right - 18, top, 18, this.boardPixelsHeight);

    context.strokeStyle = SEAM_ACCENT;
    context.lineWidth = 2;
    context.setLineDash([6, 6]);
    for (const x of [left, right]) {
      context.beginPath();
      context.moveTo(x, top);
      context.lineTo(x, bottom);
      context.stroke();
    }
    context.setLineDash([]);

    this.drawTopCaption(
      context,
      "← 左右首尾相接 · 右键/触摸拖动改变展开起点 →",
    );
    this.drawSideCaptions(context, "与右侧相接", "与左侧相接");

    context.strokeStyle = "rgba(50, 30, 18, 0.82)";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(left, top);
    context.lineTo(right, top);
    context.moveTo(left, bottom);
    context.lineTo(right, bottom);
    context.stroke();
    context.restore();
  }

  /** Long explanatory caption above the column labels (wide screens only). */
  drawTopCaption(context, text) {
    if (!Number.isFinite(this.layout?.captionY)) return;
    context.save();
    context.font = `500 ${this.layout.fonts.caption}px Inter, "Microsoft YaHei", sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "rgba(228, 233, 229, 0.84)";
    context.fillText(
      translateText(text),
      this.frameX + this.boardPixelsWidth / 2,
      this.layout.captionY,
    );
    context.restore();
  }

  /** Rotated seam captions outside the row labels on both sides. */
  drawSideCaptions(context, leftText, rightText) {
    const layout = this.layout;
    if (!Number.isFinite(layout?.leftSideCaptionX)) return;
    const middle = this.frameY + this.boardPixelsHeight / 2;
    context.save();
    context.fillStyle = SEAM_ACCENT;
    context.font = `500 ${layout.fonts.seamCaption}px Inter, "Microsoft YaHei", sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.save();
    context.translate(layout.leftSideCaptionX, middle);
    context.rotate(-Math.PI / 2);
    context.fillText(translateText(leftText), 0, 0);
    context.restore();
    context.save();
    context.translate(layout.rightSideCaptionX, middle);
    context.rotate(Math.PI / 2);
    context.fillText(translateText(rightText), 0, 0);
    context.restore();
    context.restore();
  }

  /** Tint the parts of the window that show a vertically flipped copy. */
  drawMobiusFlipTint(context) {
    if (!this.isMobius) return;
    context.save();
    context.fillStyle = FLIP_TINT;
    for (const band of mobiusWindowBands({
      offsetColumns: this.offsetColumns,
      width: this.width,
    })) {
      if (!band.flipped) continue;
      context.fillRect(
        this.frameX + band.start * this.cell,
        this.frameY,
        (band.end - band.start) * this.cell,
        this.boardPixelsHeight,
      );
    }
    context.restore();
  }

  /**
   * Inside the window the cover is continuous, but row numbers reverse where
   * one copy of the board meets the next. Mark that flip seam explicitly.
   */
  drawMobiusFlipSeams(context) {
    const bands = mobiusWindowBands({
      offsetColumns: this.offsetColumns,
      width: this.width,
    });
    const top = this.frameY;
    const bottom = this.frameY + this.boardPixelsHeight;
    for (const band of bands.slice(1)) {
      const x = this.frameX + band.start * this.cell;
      context.save();
      const glow = context.createLinearGradient(x - 10, 0, x + 10, 0);
      glow.addColorStop(0, "rgba(140, 186, 255, 0)");
      glow.addColorStop(0.5, "rgba(140, 186, 255, 0.3)");
      glow.addColorStop(1, "rgba(140, 186, 255, 0)");
      context.fillStyle = glow;
      context.fillRect(x - 10, top, 20, this.boardPixelsHeight);
      context.strokeStyle = FLIP_ACCENT;
      context.lineWidth = 2;
      context.setLineDash([10, 4, 2, 4]);
      context.beginPath();
      context.moveTo(x, top - 3);
      context.lineTo(x, bottom + 3);
      context.stroke();
      context.setLineDash([]);
      // Badges sit between two column labels, so only draw them when there
      // is room; the line, tint and label colours carry the meaning anyway.
      if (this.cell >= 22) {
        for (const y of [this.layout.topLabelY, this.layout.bottomLabelY]) {
          this.drawFlipBadge(context, x, y, Math.min(8, this.cell * 0.3));
        }
      }
      context.restore();
    }
  }

  drawFlipBadge(context, x, y, radius) {
    context.save();
    context.fillStyle = "rgba(14, 24, 38, 0.92)";
    context.strokeStyle = FLIP_ACCENT;
    context.lineWidth = 1.2;
    context.beginPath();
    context.arc(x, y, radius, 0, TAU);
    context.fill();
    context.stroke();
    // Two opposing arrows: rows run the other way across this seam.
    const arm = radius * 0.55;
    const head = radius * 0.32;
    context.lineWidth = 1.3;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    for (const [dx, direction] of [[-radius * 0.3, -1], [radius * 0.3, 1]]) {
      const tipY = y + direction * arm;
      context.moveTo(x + dx, y - direction * arm);
      context.lineTo(x + dx, tipY);
      context.moveTo(x + dx - head, tipY - direction * head);
      context.lineTo(x + dx, tipY);
      context.lineTo(x + dx + head, tipY - direction * head);
    }
    context.stroke();
    context.restore();
  }

  drawMobiusSeam(context) {
    const left = this.frameX;
    const right = this.frameX + this.boardPixelsWidth;
    const top = this.frameY;
    const bottom = this.frameY + this.boardPixelsHeight;
    const accent = "rgba(230, 185, 105, 0.98)";

    context.save();
    const leftGlow = context.createLinearGradient(left, 0, left + 20, 0);
    leftGlow.addColorStop(0, "rgba(230, 185, 105, 0.28)");
    leftGlow.addColorStop(1, "rgba(230, 185, 105, 0)");
    context.fillStyle = leftGlow;
    context.fillRect(left, top, 20, this.boardPixelsHeight);
    const rightGlow = context.createLinearGradient(right - 20, 0, right, 0);
    rightGlow.addColorStop(0, "rgba(230, 185, 105, 0)");
    rightGlow.addColorStop(1, "rgba(230, 185, 105, 0.28)");
    context.fillStyle = rightGlow;
    context.fillRect(right - 20, top, 20, this.boardPixelsHeight);

    context.strokeStyle = accent;
    context.lineWidth = 2;
    context.setLineDash([6, 6]);
    for (const x of [left, right]) {
      context.beginPath();
      context.moveTo(x, top);
      context.lineTo(x, bottom);
      context.stroke();
    }
    context.setLineDash([]);

    const arrowInset = Math.max(18, this.cell * 0.8);
    context.fillStyle = accent;
    context.beginPath();
    context.moveTo(left, top + arrowInset);
    context.lineTo(left - 5, top + arrowInset + 9);
    context.lineTo(left + 5, top + arrowInset + 9);
    context.closePath();
    context.fill();
    context.beginPath();
    context.moveTo(right, bottom - arrowInset);
    context.lineTo(right - 5, bottom - arrowInset - 9);
    context.lineTo(right + 5, bottom - arrowInset - 9);
    context.closePath();
    context.fill();

    context.strokeStyle = "rgba(50, 30, 18, 0.84)";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(left, top);
    context.lineTo(right, top);
    context.moveTo(left, bottom);
    context.lineTo(right, bottom);
    context.stroke();
    context.restore();

    this.drawMobiusFlipSeams(context);
    this.drawTopCaption(context, "↕ 左右反向相接 · 横向一圈后上下翻转");
    this.drawSideCaptions(context, "与右侧倒序相接", "与左侧倒序相接");
  }

  drawTorusSeam(context) {
    const left = this.frameX;
    const right = this.frameX + this.boardPixelsWidth;
    const top = this.frameY;
    const bottom = this.frameY + this.boardPixelsHeight;

    context.save();
    const horizontalGlow = 18;
    const verticalGlow = 18;
    const leftGlow = context.createLinearGradient(left, 0, left + horizontalGlow, 0);
    leftGlow.addColorStop(0, "rgba(230, 185, 105, 0.24)");
    leftGlow.addColorStop(1, "rgba(230, 185, 105, 0)");
    context.fillStyle = leftGlow;
    context.fillRect(left, top, horizontalGlow, this.boardPixelsHeight);

    const rightGlow = context.createLinearGradient(right - horizontalGlow, 0, right, 0);
    rightGlow.addColorStop(0, "rgba(230, 185, 105, 0)");
    rightGlow.addColorStop(1, "rgba(230, 185, 105, 0.24)");
    context.fillStyle = rightGlow;
    context.fillRect(
      right - horizontalGlow,
      top,
      horizontalGlow,
      this.boardPixelsHeight,
    );

    const topGlow = context.createLinearGradient(0, top, 0, top + verticalGlow);
    topGlow.addColorStop(0, "rgba(230, 185, 105, 0.24)");
    topGlow.addColorStop(1, "rgba(230, 185, 105, 0)");
    context.fillStyle = topGlow;
    context.fillRect(left, top, this.boardPixelsWidth, verticalGlow);

    const bottomGlow = context.createLinearGradient(0, bottom - verticalGlow, 0, bottom);
    bottomGlow.addColorStop(0, "rgba(230, 185, 105, 0)");
    bottomGlow.addColorStop(1, "rgba(230, 185, 105, 0.24)");
    context.fillStyle = bottomGlow;
    context.fillRect(
      left,
      bottom - verticalGlow,
      this.boardPixelsWidth,
      verticalGlow,
    );

    context.strokeStyle = SEAM_ACCENT;
    context.lineWidth = 2;
    context.setLineDash([6, 6]);
    context.strokeRect(left, top, this.boardPixelsWidth, this.boardPixelsHeight);
    context.setLineDash([]);

    this.drawTopCaption(
      context,
      "↔ 左右相接 · ↕ 上下相接 · 右键/触摸任意方向拖动",
    );
    this.drawSideCaptions(context, "与右侧相接", "与左侧相接");

    // Top and bottom seam captions sit outside the column labels so they
    // never cover stones on the first or last row.
    context.fillStyle = SEAM_ACCENT;
    context.font = `500 ${this.layout.fonts.seamCaption}px Inter, "Microsoft YaHei", sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(
      translateText("与下侧相接"),
      (left + right) / 2,
      this.layout.topSeamCaptionY,
    );
    context.fillText(
      translateText("与上侧相接"),
      (left + right) / 2,
      this.layout.bottomSeamCaptionY,
    );
    context.restore();
  }

  drawColumnLabels(context) {
    if (this.cell < 10) return;
    context.save();
    context.font = `500 ${this.layout.fonts.label}px Inter, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = LABEL_COLOR;
    for (let col = 0; col < this.width; col += 1) {
      const x = this.pointX(col);
      const label = formatGoColumn(col) || String(col + 1);
      context.fillText(label, x, this.layout.topLabelY);
      context.fillText(label, x, this.layout.bottomLabelY);
    }
    this.drawRowLabels(context);
    context.restore();
  }

  drawRowLabels(context) {
    const leftX = this.layout.leftRowLabelX;
    const rightX = this.layout.rightRowLabelX;
    const drawPair = (y, leftLabel, rightLabel, leftColor, rightColor) => {
      context.textAlign = "right";
      context.fillStyle = leftColor;
      context.fillText(leftLabel, leftX, y);
      context.textAlign = "left";
      context.fillStyle = rightColor;
      context.fillText(rightLabel, rightX, y);
    };

    if (this.isMobius) {
      // Each side is labelled for the copy of the board at that edge; a
      // flipped copy is shown in the flip colour to match its tint and seam.
      const copies = mobiusWindowCopies({
        offsetColumns: this.offsetColumns,
        width: this.width,
      });
      const leftLabels = mobiusRowLabelsForCopy(copies.leftCopy, this.height);
      const rightLabels = mobiusRowLabelsForCopy(copies.rightCopy, this.height);
      for (let visualRow = 0; visualRow < this.height; visualRow += 1) {
        drawPair(
          this.frameY + (visualRow + 0.5) * this.cell,
          leftLabels[visualRow],
          rightLabels[visualRow],
          copies.leftFlipped ? FLIP_LABEL_COLOR : LABEL_COLOR,
          copies.rightFlipped ? FLIP_LABEL_COLOR : LABEL_COLOR,
        );
      }
      return;
    }

    for (let row = 0; row < this.height; row += 1) {
      const label = flatRowLabel(row, this.height);
      drawPair(this.pointY(row), label, label, LABEL_COLOR, LABEL_COLOR);
    }
  }

  destroy() {
    this.destroyed = true;
    this.active = false;
    this.cancelSnap();
    this.cancelFlipPulse();
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("pointercancel", this.handlePointerCancel);
    this.canvas.removeEventListener("pointerleave", this.handlePointerLeave);
    this.canvas.removeEventListener("contextmenu", this.handleContextMenu);
    this.canvas.remove();
  }
}

export default FlatBoard;
