const TAU = Math.PI * 2;
const DRAG_THRESHOLD = 6;
const COORDINATE_LETTERS = "ABCDEFGHJKLMNOPQRSTUVWXYZ";

function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
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
  constructor(container, { size = 19, onPoint, onHover, onPan } = {}) {
    this.container = container;
    this.onPoint = onPoint;
    this.onHover = onHover;
    this.onPan = onPan;
    this.size = size;
    this.board = [];
    this.currentPlayer = "black";
    this.phase = "play";
    this.lastMove = null;
    this.deadKeys = new Set();
    this.hoveredPoint = null;
    this.offsetColumns = 0;
    this.pointerState = null;
    this.snapFrame = null;
    this.movePreviewEnabled = true;
    this.active = true;
    this.destroyed = false;

    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute(
      "aria-label",
      "竹筒围棋的平面展开视图。左右两侧首尾相接，可横向拖动改变展开起点。",
    );
    this.context = this.canvas.getContext("2d");
    this.container.appendChild(this.canvas);

    this.handlePointerDown = (event) => this.pointerDown(event);
    this.handlePointerMove = (event) => this.pointerMove(event);
    this.handlePointerUp = (event) => this.pointerUp(event);
    this.handlePointerCancel = (event) => this.pointerCancel(event);
    this.handlePointerLeave = () => {
      if (!this.pointerState) this.setHoveredPoint(null);
    };

    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerup", this.handlePointerUp);
    this.canvas.addEventListener("pointercancel", this.handlePointerCancel);
    this.canvas.addEventListener("pointerleave", this.handlePointerLeave);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.rebuild(size);
  }

  rebuild(size) {
    this.size = size;
    this.board = Array.from({ length: size }, () => Array(size).fill(null));
    this.currentPlayer = "black";
    this.phase = "play";
    this.lastMove = null;
    this.deadKeys.clear();
    this.offsetColumns = 0;
    this.hoveredPoint = null;
    this.pointerState = null;
    this.container.classList.remove("dragging");
    this.cancelSnap();
    this.resize();
    this.notifyPan();
  }

  setPosition({ board, currentPlayer, phase, lastMove, deadStones = [] }) {
    this.board = board;
    this.currentPlayer = currentPlayer;
    this.phase = phase;
    this.lastMove = lastMove;
    this.deadKeys = new Set(deadStones.map(({ row, col }) => `${row},${col}`));
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
    this.animateOffsetTo(0);
  }

  resize() {
    if (this.destroyed || !this.active) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = width;
    this.height = height;
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
        (width - sidePadding * 2) / this.size,
        (height - verticalPadding * 2) / this.size,
      ),
    );
    this.boardPixels = this.cell * this.size;
    this.frameX = (width - this.boardPixels) / 2;
    this.frameY = (height - this.boardPixels) / 2;
    this.draw();
  }

  pointX(col) {
    return (
      this.frameX +
      mod(col + this.offsetColumns + 0.5, this.size) * this.cell
    );
  }

  pointY(row) {
    return this.frameY + (row + 0.5) * this.cell;
  }

  hitPoint(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (
      x < this.frameX ||
      x > this.frameX + this.boardPixels ||
      y < this.frameY ||
      y > this.frameY + this.boardPixels
    ) {
      return null;
    }

    const visualColumn = (x - this.frameX) / this.cell - 0.5;
    const logicalColumn = Math.round(visualColumn - this.offsetColumns);
    const col = mod(logicalColumn, this.size);
    const row = Math.round((y - this.frameY) / this.cell - 0.5);
    if (row < 0 || row >= this.size) return null;

    const nearestX = this.pointX(col);
    const directDistance = Math.abs(x - nearestX);
    const xDistance = Math.min(
      directDistance,
      this.boardPixels - directDistance,
    );
    const yDistance = Math.abs(y - this.pointY(row));
    if (xDistance > this.cell * 0.48 || yDistance > this.cell * 0.48) {
      return null;
    }
    return { row, col };
  }

  pointerDown(event) {
    if (
      !this.active ||
      event.isPrimary === false ||
      this.pointerState ||
      (event.pointerType === "mouse" && event.button !== 0)
    ) {
      return;
    }
    this.cancelSnap();
    this.pointerState = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: this.offsetColumns,
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
      if (
        Math.abs(deltaX) > DRAG_THRESHOLD &&
        Math.abs(deltaX) > Math.abs(deltaY)
      ) {
        pointer.moved = true;
      }
      if (pointer.moved) {
        this.container.classList.add("dragging");
        this.offsetColumns = mod(
          pointer.startOffset + deltaX / this.cell,
          this.size,
        );
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
    const moved = pointer.moved || horizontalDrag;
    this.pointerState = null;
    this.container.classList.remove("dragging");
    if (this.canvas.hasPointerCapture?.(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }

    if (moved) {
      if (!pointer.moved) {
        this.offsetColumns = mod(
          pointer.startOffset + deltaX / this.cell,
          this.size,
        );
        this.draw();
        this.notifyPan();
      }
      this.snapToColumn();
      return;
    }
    if (pointer.cancelClick || crossedThreshold) return;
    const point = this.hitPoint(event.clientX, event.clientY);
    if (point && this.onPoint) this.onPoint(point);
  }

  pointerCancel(event) {
    if (!this.pointerState || this.pointerState.id !== event.pointerId) return;
    this.pointerState = null;
    this.container.classList.remove("dragging");
    this.setHoveredPoint(null);
    this.snapToColumn();
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
    const nearest = Math.round(this.offsetColumns);
    this.animateOffsetTo(nearest);
  }

  animateOffsetTo(target) {
    this.cancelSnap();
    const start = this.offsetColumns;
    let adjustedTarget = target;
    while (adjustedTarget - start > this.size / 2) adjustedTarget -= this.size;
    while (adjustedTarget - start < -this.size / 2) adjustedTarget += this.size;
    const startedAt = performance.now();
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : 180;

    const step = (now) => {
      const progress = duration === 0 ? 1 : Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      this.offsetColumns = start + (adjustedTarget - start) * eased;
      this.draw();
      this.notifyPan();
      if (progress < 1) {
        this.snapFrame = requestAnimationFrame(step);
      } else {
        this.offsetColumns = mod(adjustedTarget, this.size);
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
    const startCol = mod(-Math.round(this.offsetColumns), this.size);
    this.onPan({ startCol, offsetColumns: this.offsetColumns });
  }

  draw() {
    if (!this.active || !this.context || !this.cell) return;
    const context = this.context;
    context.clearRect(0, 0, this.width, this.height);

    this.drawBoardSurface(context);
    this.drawGrid(context);
    this.drawStarPoints(context);
    this.drawStones(context);
    this.drawHover(context);
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
      this.frameX + this.boardPixels,
      this.frameY + this.boardPixels,
    );
    gradient.addColorStop(0, "#d19a56");
    gradient.addColorStop(0.5, "#b97c3b");
    gradient.addColorStop(1, "#9a5f2e");
    context.fillStyle = gradient;
    context.fillRect(this.frameX, this.frameY, this.boardPixels, this.boardPixels);
    context.restore();

    context.save();
    context.beginPath();
    context.rect(this.frameX, this.frameY, this.boardPixels, this.boardPixels);
    context.clip();
    context.globalAlpha = 0.1;
    context.lineWidth = 1;
    for (let grain = -this.boardPixels; grain < this.boardPixels * 2; grain += 17) {
      context.beginPath();
      context.moveTo(this.frameX + grain, this.frameY);
      for (let y = this.frameY; y <= this.frameY + this.boardPixels; y += 18) {
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
    context.rect(this.frameX, this.frameY, this.boardPixels, this.boardPixels);
    context.clip();
    context.strokeStyle = "rgba(39, 25, 17, 0.88)";
    context.lineWidth = clamp(this.cell * 0.035, 0.8, 1.45);

    for (let row = 0; row < this.size; row += 1) {
      const y = this.pointY(row);
      context.beginPath();
      context.moveTo(this.frameX, y);
      context.lineTo(this.frameX + this.boardPixels, y);
      context.stroke();
    }

    for (let col = 0; col < this.size; col += 1) {
      const x = this.pointX(col);
      context.beginPath();
      context.moveTo(x, this.pointY(0));
      context.lineTo(x, this.pointY(this.size - 1));
      context.stroke();
    }
    context.restore();
  }

  drawStarPoints(context) {
    const stars = starIndices(this.size);
    context.save();
    context.beginPath();
    context.rect(this.frameX, this.frameY, this.boardPixels, this.boardPixels);
    context.clip();
    context.fillStyle = "#28190f";
    const radius = clamp(this.cell * 0.105, 1.7, 4.2);
    for (const row of stars) {
      for (const col of stars) {
        this.forEachWrappedX(this.pointX(col), radius, (x) => {
          context.beginPath();
          context.arc(x, this.pointY(row), radius, 0, TAU);
          context.fill();
        });
      }
    }
    context.restore();
  }

  forEachWrappedX(x, radius, callback) {
    for (const shiftedX of [x - this.boardPixels, x, x + this.boardPixels]) {
      if (
        shiftedX + radius >= this.frameX &&
        shiftedX - radius <= this.frameX + this.boardPixels
      ) {
        callback(shiftedX);
      }
    }
  }

  drawStones(context) {
    if (!this.board?.length) return;
    const radius = this.cell * 0.41;
    context.save();
    context.beginPath();
    context.rect(this.frameX, this.frameY, this.boardPixels, this.boardPixels);
    context.clip();

    for (let row = 0; row < this.size; row += 1) {
      for (let col = 0; col < this.size; col += 1) {
        const color = this.board[row]?.[col];
        if (!color) continue;
        const dead = this.deadKeys.has(`${row},${col}`);
        this.forEachWrappedX(this.pointX(col), radius, (x) => {
          this.drawStone(context, x, this.pointY(row), radius, color, dead);
          if (
            this.lastMove?.type === "play" &&
            this.lastMove.row === row &&
            this.lastMove.col === col
          ) {
            context.beginPath();
            context.arc(x, this.pointY(row), radius * 0.24, 0, TAU);
            context.strokeStyle = "#d9aa58";
            context.lineWidth = Math.max(1.5, radius * 0.11);
            context.stroke();
          }
        });
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
    context.rect(this.frameX, this.frameY, this.boardPixels, this.boardPixels);
    context.clip();
    context.globalAlpha = 0.48;
    this.forEachWrappedX(this.pointX(point.col), radius, (x) => {
      this.drawStone(
        context,
        x,
        this.pointY(point.row),
        radius,
        this.currentPlayer,
        false,
      );
    });
    context.restore();
  }

  drawSeam(context) {
    const left = this.frameX;
    const right = this.frameX + this.boardPixels;
    const top = this.frameY;
    const bottom = this.frameY + this.boardPixels;
    const accent = "rgba(230, 185, 105, 0.95)";

    context.save();
    const leftGlow = context.createLinearGradient(left, 0, left + 18, 0);
    leftGlow.addColorStop(0, "rgba(230, 185, 105, 0.22)");
    leftGlow.addColorStop(1, "rgba(230, 185, 105, 0)");
    context.fillStyle = leftGlow;
    context.fillRect(left, top, 18, this.boardPixels);
    const rightGlow = context.createLinearGradient(right - 18, 0, right, 0);
    rightGlow.addColorStop(0, "rgba(230, 185, 105, 0)");
    rightGlow.addColorStop(1, "rgba(230, 185, 105, 0.22)");
    context.fillStyle = rightGlow;
    context.fillRect(right - 18, top, 18, this.boardPixels);

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
    if (this.width >= 560) {
      context.fillText(
        "← 左右首尾相接 · 拖动改变展开起点 →",
        (left + right) / 2,
        top - 30,
      );
    }

    context.fillStyle = accent;
    context.font = `500 ${clamp(labelSize * 0.9, 9, 11)}px Inter, "Microsoft YaHei", sans-serif`;
    context.save();
    context.translate(left - 20, (top + bottom) / 2);
    context.rotate(-Math.PI / 2);
    context.fillText("与右侧相接", 0, 0);
    context.restore();
    context.save();
    context.translate(right + 20, (top + bottom) / 2);
    context.rotate(Math.PI / 2);
    context.fillText("与左侧相接", 0, 0);
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

  drawColumnLabels(context) {
    if (this.cell < 10) return;
    const labelSize = clamp(this.cell * 0.24, 8, 11);
    context.save();
    context.font = `500 ${labelSize}px Inter, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "rgba(235, 240, 237, 0.54)";
    for (let col = 0; col < this.size; col += 1) {
      const x = this.pointX(col);
      const label = COORDINATE_LETTERS[col] || String(col + 1);
      context.fillText(label, x, this.frameY - 10);
      context.fillText(label, x, this.frameY + this.boardPixels + 11);
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
    this.canvas.remove();
  }
}

export default FlatBoard;
