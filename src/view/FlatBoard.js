import {
  mobiusPointFromCover,
  mobiusPointInCopy,
} from "../game/mobiusTopology.js";
import { formatGoColumn } from "../game/boardDimensions.js";
import {
  invalidatePendingTapOnAdditionalPointer,
  pointerGestureRoles,
  preventBoardContextMenu,
} from "./pointerGestures.js";
import { translateText } from "../i18n.js";
import {
  TERRITORY_MARKER_STYLES,
  territoryPointsForPosition,
} from "./territoryMarkers.js";

const TAU = Math.PI * 2;
const DRAG_THRESHOLD = 6;

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

function starIndices(size) {
  if (size === 19) return [3, 9, 15];
  if (size === 13) return [3, 6, 9];
  if (size === 9) return [2, 4, 6];
  const center = Math.floor(size / 2);
  if (size < 7) return [center];
  const offset = Math.max(2, Math.round(size * 0.28));
  return [center - offset, center, center + offset];
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
    this.draw();
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

    const sidePadding = width < 560 ? 36 : 72;
    const verticalPadding = height < 620 ? 54 : 72;
    this.cell = Math.max(
      8,
      Math.min(
        (width - sidePadding * 2) / this.width,
        (height - verticalPadding * 2) / this.height,
      ),
    );
    this.boardPixelsWidth = this.cell * this.width;
    this.boardPixelsHeight = this.cell * this.height;
    this.frameX = (width - this.boardPixelsWidth) / 2;
    this.frameY = (height - this.boardPixelsHeight) / 2;
    this.draw();
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
    this.drawGrid(context);
    this.drawStarPoints(context);
    this.drawTerritory(context);
    this.drawStones(context);
    this.drawHover(context);
    this.drawAnalysisCandidates(context);
    this.drawAnalysisMove(context);
    this.drawAnalysisVariation(context);
    this.drawReferencePoint(context);
    this.drawSeam(context);
    this.drawColumnLabels(context);
  }

  drawBoardSurface(context) {
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
    gradient.addColorStop(0, "#d19a56");
    gradient.addColorStop(0.5, "#b97c3b");
    gradient.addColorStop(1, "#9a5f2e");
    context.fillStyle = gradient;
    context.fillRect(
      this.frameX,
      this.frameY,
      this.boardPixelsWidth,
      this.boardPixelsHeight,
    );
    context.restore();

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
    context.strokeStyle = "rgba(39, 25, 17, 0.88)";
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
    const rowStars = starIndices(this.height);
    const columnStars = starIndices(this.width);
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
    for (const row of rowStars) {
      for (const col of columnStars) {
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

  drawStone(context, x, y, radius, color, dead) {
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
    const accent = "rgba(230, 185, 105, 0.95)";

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

    const labelSize = clamp(this.cell * 0.3, 10, 13);
    context.font = `500 ${labelSize}px Inter, "Microsoft YaHei", sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "rgba(228, 233, 229, 0.82)";
    if (this.viewportWidth >= 560) {
      context.fillText(
        translateText("← 左右首尾相接 · 右键/触摸拖动改变展开起点 →"),
        (left + right) / 2,
        top - 30,
      );
    }

    context.fillStyle = accent;
    context.font = `500 ${clamp(labelSize * 0.9, 9, 11)}px Inter, "Microsoft YaHei", sans-serif`;
    context.save();
    context.translate(left - 20, (top + bottom) / 2);
    context.rotate(-Math.PI / 2);
    context.fillText(translateText("与右侧相接"), 0, 0);
    context.restore();
    context.save();
    context.translate(right + 20, (top + bottom) / 2);
    context.rotate(Math.PI / 2);
    context.fillText(translateText("与左侧相接"), 0, 0);
    context.restore();

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

    const labelSize = clamp(this.cell * 0.3, 10, 13);
    context.font = `500 ${labelSize}px Inter, "Microsoft YaHei", sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "rgba(228, 233, 229, 0.86)";
    if (this.viewportWidth >= 560) {
      context.fillText(
        translateText("↕ 左右反向相接 · 横向一圈后上下翻转"),
        (left + right) / 2,
        top - 30,
      );
    }

    context.fillStyle = accent;
    context.font = `500 ${clamp(labelSize * 0.9, 9, 11)}px Inter, "Microsoft YaHei", sans-serif`;
    context.save();
    context.translate(left - 20, (top + bottom) / 2);
    context.rotate(-Math.PI / 2);
    context.fillText(translateText("与右侧倒序相接"), 0, 0);
    context.restore();
    context.save();
    context.translate(right + 20, (top + bottom) / 2);
    context.rotate(Math.PI / 2);
    context.fillText(translateText("与左侧倒序相接"), 0, 0);
    context.restore();
    context.restore();
  }

  drawTorusSeam(context) {
    const left = this.frameX;
    const right = this.frameX + this.boardPixelsWidth;
    const top = this.frameY;
    const bottom = this.frameY + this.boardPixelsHeight;
    const accent = "rgba(230, 185, 105, 0.95)";

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

    context.strokeStyle = accent;
    context.lineWidth = 2;
    context.setLineDash([6, 6]);
    context.strokeRect(left, top, this.boardPixelsWidth, this.boardPixelsHeight);
    context.setLineDash([]);

    const labelSize = clamp(this.cell * 0.3, 10, 13);
    context.font = `500 ${labelSize}px Inter, "Microsoft YaHei", sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "rgba(228, 233, 229, 0.84)";
    if (this.viewportWidth >= 560) {
      context.fillText(
        translateText("↔ 左右相接 · ↕ 上下相接 · 右键/触摸任意方向拖动"),
        (left + right) / 2,
        top - 30,
      );
    }

    context.fillStyle = accent;
    context.font = `500 ${clamp(labelSize * 0.9, 9, 11)}px Inter, "Microsoft YaHei", sans-serif`;
    context.save();
    context.translate(left - 20, (top + bottom) / 2);
    context.rotate(-Math.PI / 2);
    context.fillText(translateText("与右侧相接"), 0, 0);
    context.restore();
    context.save();
    context.translate(right + 20, (top + bottom) / 2);
    context.rotate(Math.PI / 2);
    context.fillText(translateText("与左侧相接"), 0, 0);
    context.restore();
    context.fillText(
      translateText("与下侧相接"),
      (left + right) / 2,
      top + 12,
    );
    context.fillText(
      translateText("与上侧相接"),
      (left + right) / 2,
      bottom - 12,
    );
    context.restore();
  }

  drawColumnLabels(context) {
    if (this.cell < 10) return;
    const labelSize = clamp(this.cell * 0.24, 8, 11);
    context.save();
    context.font = `500 ${labelSize}px Inter, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "rgba(235, 240, 237, 0.54)";
    for (let col = 0; col < this.width; col += 1) {
      const x = this.pointX(col);
      const label = formatGoColumn(col) || String(col + 1);
      context.fillText(label, x, this.frameY - 10);
      context.fillText(label, x, this.frameY + this.boardPixelsHeight + 11);
    }
    if (this.wrapRows) {
      for (let row = 0; row < this.height; row += 1) {
        const y = this.pointY(row);
        const label = String(this.height - row);
        context.textAlign = "right";
        context.fillText(label, this.frameX - 9, y);
        context.textAlign = "left";
        context.fillText(label, this.frameX + this.boardPixelsWidth + 9, y);
      }
    } else if (this.isMobius) {
      const leftCoverColumn = Math.round(-this.offsetColumns);
      const rightCoverColumn = Math.round(
        this.width - 1 - this.offsetColumns,
      );
      for (let visualRow = 0; visualRow < this.height; visualRow += 1) {
        const y = this.frameY + (visualRow + 0.5) * this.cell;
        const leftPoint = mobiusPointFromCover(
          visualRow,
          leftCoverColumn,
          this.width,
          this.height,
        );
        const rightPoint = mobiusPointFromCover(
          visualRow,
          rightCoverColumn,
          this.width,
          this.height,
        );
        context.textAlign = "right";
        context.fillText(
          String(this.height - leftPoint.row),
          this.frameX - 9,
          y,
        );
        context.textAlign = "left";
        context.fillText(
          String(this.height - rightPoint.row),
          this.frameX + this.boardPixelsWidth + 9,
          y,
        );
      }
    }
    context.restore();
  }

  destroy() {
    this.destroyed = true;
    this.active = false;
    this.cancelSnap();
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
