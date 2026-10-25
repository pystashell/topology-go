import * as THREE from "three";
import { FlipWave } from "./flipWave.js";

/**
 * Gomoku / Othello position markers shared by every renderer:
 * - winLine: the winning run, highlighted on its stones (ordered along the line);
 * - forbidden: Renju points Black may not play (empty points);
 * - legal: Othello moves for the side to move (empty points);
 * - flipped: discs turned by the last move, outlined; each ring grows in as
 *   its disc turns over in the flip wave (see flipWave.js).
 *
 * The pure helpers normalise marker sets and pair line cells on screen; the
 * 3D part is an instanced, non-interactive layer modelled on
 * territoryMarkers.js plus a hover cross for forbidden points.
 */

export const GAME_MARKER_KINDS = Object.freeze([
  "winLine",
  "forbidden",
  "legal",
  "flipped",
]);

export const EMPTY_GAME_MARKERS = Object.freeze({
  winLine: Object.freeze([]),
  forbidden: Object.freeze([]),
  legal: Object.freeze([]),
  flipped: Object.freeze([]),
});

export const GAME_MARKER_STYLES = Object.freeze({
  win: Object.freeze({
    glow: "rgba(255, 196, 64, 0.95)",
    ring: "rgba(255, 221, 120, 0.98)",
    stroke: "rgba(255, 214, 102, 0.86)",
    color: 0xffdf80,
    haloColor: 0xffb52e,
  }),
  forbidden: Object.freeze({
    stroke: "rgba(214, 36, 46, 0.92)",
    hoverStroke: "rgba(236, 40, 52, 0.98)",
    hoverFill: "rgba(214, 36, 46, 0.18)",
    color: 0xd9262f,
    hoverColor: 0xff3b44,
  }),
  legal: Object.freeze({
    black: Object.freeze({ fill: "rgba(10, 14, 12, 0.42)", color: 0x0a0e0c, opacity: 0.45 }),
    white: Object.freeze({ fill: "rgba(250, 248, 240, 0.62)", color: 0xfaf8f0, opacity: 0.66 }),
  }),
  flipped: Object.freeze({
    stroke: "rgba(120, 214, 255, 0.95)",
    color: 0x78d6ff,
  }),
});

function pointFrom(value) {
  if (Array.isArray(value)) return { row: value[0], col: value[1] };
  return value;
}

export function gameMarkerKey(point) {
  return `${point.row},${point.col}`;
}

function normalizePoints(values, { width, height, board, occupied, sort, keepDistance = false }) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const points = [];
  for (const value of values) {
    const point = pointFrom(value);
    const row = point?.row;
    const col = point?.col;
    if (
      !Number.isInteger(row) ||
      !Number.isInteger(col) ||
      row < 0 ||
      col < 0 ||
      (Number.isInteger(height) && row >= height) ||
      (Number.isInteger(width) && col >= width)
    ) {
      continue;
    }
    if (board && Boolean(board[row]?.[col]) !== occupied) continue;
    const key = `${row},${col}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push(
      keepDistance && Number.isInteger(point.distance) && point.distance > 0
        ? { row, col, distance: point.distance }
        : { row, col },
    );
  }
  if (sort) points.sort((left, right) => left.row - right.row || left.col - right.col);
  return points;
}

/**
 * Validate a view's `gameMarkers` input into four de-duplicated point lists.
 * Points accept {row, col} or [row, col]; off-board points are dropped. With
 * a board, stone markers (winLine, flipped) need a stone and point markers
 * (forbidden, legal) need an empty point. winLine keeps its order along the
 * line; the other lists are sorted row-major so signatures are stable.
 * Flipped discs keep their distance from the new disc; `flipOrigin` (the new
 * disc) and `animateFlips` (the page just played the move) drive the flip
 * wave.
 */
export function normalizeGameMarkers(gameMarkers = null, { width, height, board } = {}) {
  if (!gameMarkers || typeof gameMarkers !== "object") return EMPTY_GAME_MARKERS;
  const options = { width, height, board };
  const markers = {
    winLine: normalizePoints(gameMarkers.winLine, { ...options, occupied: true, sort: false }),
    forbidden: normalizePoints(gameMarkers.forbidden, { ...options, occupied: false, sort: true }),
    legal: normalizePoints(gameMarkers.legal, { ...options, occupied: false, sort: true }),
    flipped: normalizePoints(gameMarkers.flipped, { ...options, occupied: true, sort: true, keepDistance: true }),
  };
  if (!hasGameMarkers(markers)) return EMPTY_GAME_MARKERS;
  if (markers.flipped.length > 0) {
    const origin = gameMarkers.flipOrigin;
    if (Number.isInteger(origin?.row) && Number.isInteger(origin?.col)) {
      markers.flipOrigin = { row: origin.row, col: origin.col };
    }
    markers.animateFlips = gameMarkers.animateFlips === true;
  }
  return markers;
}

export function hasGameMarkers(markers) {
  return GAME_MARKER_KINDS.some((kind) => markers?.[kind]?.length > 0);
}

export function gameMarkerPointsSignature(points = []) {
  return points.map(gameMarkerKey).join(";");
}

export function gameMarkersSignature(markers = EMPTY_GAME_MARKERS) {
  if (!hasGameMarkers(markers)) return "";
  return GAME_MARKER_KINDS
    .map((kind) => `${kind}:${gameMarkerPointsSignature(markers[kind])}`)
    .join("|");
}

/**
 * Screen segments joining neighbouring cells of a line, for renderers that
 * show several images of each point (wrapped columns, torus rows, Mobius
 * cover copies). `imagesOf(row, col)` returns every on-screen image {x, y};
 * a segment joins two images of consecutive cells only when they sit one
 * grid `step` apart horizontally, vertically or diagonally. Pairs that meet
 * only through a seam therefore draw as two clipped half-segments at the
 * window edges, and a Mobius flip pairs the mirrored images. The pair of last
 * and first cell is tried too, so a line that wraps into a full cycle closes.
 */
export function lineSegmentsOnScreen(
  cells,
  imagesOf,
  { step = 1, tolerance = 0.2 } = {},
) {
  if (!Array.isArray(cells) || cells.length < 2 || typeof imagesOf !== "function") {
    return [];
  }
  const imageCache = new Map();
  const images = (cell) => {
    const key = gameMarkerKey(cell);
    if (!imageCache.has(key)) {
      const unique = new Map();
      for (const image of imagesOf(cell.row, cell.col) ?? []) {
        unique.set(`${image.x.toFixed(3)},${image.y.toFixed(3)}`, image);
      }
      imageCache.set(key, [...unique.values()]);
    }
    return imageCache.get(key);
  };
  const unitOffset = (delta) => {
    const units = Math.abs(delta) / step;
    const rounded = Math.round(units);
    return rounded <= 1 && Math.abs(units - rounded) <= tolerance ? rounded : null;
  };

  const pairs = cells.slice(1).map((cell, index) => [cells[index], cell]);
  if (cells.length > 2) pairs.push([cells[cells.length - 1], cells[0]]);
  const segments = [];
  pairs.forEach(([from, to], index) => {
    for (const start of images(from)) {
      for (const end of images(to)) {
        const dx = unitOffset(end.x - start.x);
        const dy = unitOffset(end.y - start.y);
        if (dx === null || dy === null || dx + dy === 0) continue;
        segments.push({
          from: { x: start.x, y: start.y },
          to: { x: end.x, y: end.y },
          index,
        });
      }
    }
  });
  return segments;
}

export function prefersReducedMotion() {
  try {
    return Boolean(
      globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
    );
  } catch {
    return false;
  }
}

function currentTime() {
  return globalThis.performance?.now?.() ?? Date.now();
}

// ---------------------------------------------------------------------------
// 3D layer

const LOCAL_FORWARD = new THREE.Vector3(0, 0, 1);
const INSTANCE_POSITION = new THREE.Vector3();
const INSTANCE_OUTWARD = new THREE.Vector3();
const INSTANCE_UP = new THREE.Vector3();
const INSTANCE_RIGHT = new THREE.Vector3();
const INSTANCE_BASIS = new THREE.Matrix4();
const INSTANCE_QUATERNION = new THREE.Quaternion();
const INSTANCE_SCALE = new THREE.Vector3();
const INSTANCE_MATRIX = new THREE.Matrix4();

/**
 * Compose a marker transform on a board point. `frame` is {position, normal}
 * with an optional in-surface `up` tangent; with it, crosses keep their arms
 * diagonal to the grid lines instead of an arbitrary twist.
 */
function composeMarkerMatrix(frame, { sign = 1, offset = 0, scale = 1 }, target) {
  INSTANCE_OUTWARD
    .set(frame.normal.x, frame.normal.y, frame.normal.z)
    .multiplyScalar(sign)
    .normalize();
  INSTANCE_POSITION
    .set(frame.position.x, frame.position.y, frame.position.z)
    .addScaledVector(INSTANCE_OUTWARD, offset);
  let oriented = false;
  if (frame.up) {
    INSTANCE_UP.set(frame.up.x, frame.up.y, frame.up.z);
    INSTANCE_UP.addScaledVector(INSTANCE_OUTWARD, -INSTANCE_UP.dot(INSTANCE_OUTWARD));
    if (INSTANCE_UP.lengthSq() > 1e-10) {
      INSTANCE_UP.normalize();
      INSTANCE_RIGHT.crossVectors(INSTANCE_UP, INSTANCE_OUTWARD).normalize();
      INSTANCE_UP.crossVectors(INSTANCE_OUTWARD, INSTANCE_RIGHT).normalize();
      INSTANCE_BASIS.makeBasis(INSTANCE_RIGHT, INSTANCE_UP, INSTANCE_OUTWARD);
      INSTANCE_QUATERNION.setFromRotationMatrix(INSTANCE_BASIS);
      oriented = true;
    }
  }
  if (!oriented) INSTANCE_QUATERNION.setFromUnitVectors(LOCAL_FORWARD, INSTANCE_OUTWARD);
  INSTANCE_SCALE.set(scale, scale, scale);
  return target.compose(INSTANCE_POSITION, INSTANCE_QUATERNION, INSTANCE_SCALE);
}

/** A unit "✕": two crossed bars in the local XY plane. */
export function createCrossGeometry({ arm = 0.42, thickness = 0.075 } = {}) {
  const positions = [];
  const indices = [];
  for (const angle of [Math.PI / 4, -Math.PI / 4]) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const base = positions.length / 3;
    for (const [x, y] of [
      [-arm, -thickness],
      [arm, -thickness],
      [arm, thickness],
      [-arm, thickness],
    ]) {
      positions.push(x * cos - y * sin, x * sin + y * cos, 0);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(
      Array.from({ length: positions.length / 3 }, () => [0, 0, 1]).flat(),
      3,
    ),
  );
  geometry.setIndex(indices);
  return geometry;
}

function markerMaterial(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
}

function markerEntries(points, paired) {
  const signs = paired ? [-1, 1] : [1];
  return points.flatMap((point) => signs.map((sign) => ({ ...point, sign })));
}

function createInstancedMarker(entries, geometry, material, {
  name,
  offset,
  scale,
  renderOrder = 1,
  flipRing = false,
}) {
  const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
  mesh.name = name;
  mesh.renderOrder = renderOrder;
  mesh.frustumCulled = false;
  // Picking only ever targets the board surface; keep overlays inert.
  mesh.raycast = () => {};
  mesh.userData.gameMarkerEntries = entries;
  mesh.userData.markerOffset = offset;
  mesh.userData.markerScale = scale;
  mesh.userData.flipRing = flipRing;
  return mesh;
}

/**
 * Create the instanced marker layer (null when there is nothing to draw).
 * Options: frameAt(row, col) -> {position, normal, up?} at the surface;
 * stoneRadius scales every marker; surfaceOffset lifts rings and dots off the
 * surface and raisedOffset lifts crosses clear of star points; paired adds a
 * mirrored instance for two-sided (Mobius) surfaces; flipWave (a running
 * FlipWave) grows each flip ring in as its disc turns.
 */
export function createGameMarkerLayer(markers, {
  frameAt,
  stoneRadius = 0.4,
  surfaceOffset = 0.058,
  raisedOffset = surfaceOffset,
  paired = false,
  currentPlayer = "black",
  flipWave = null,
} = {}) {
  if (!hasGameMarkers(markers)) return null;
  if (typeof frameAt !== "function") throw new TypeError("frameAt must be a function");

  const group = new THREE.Group();
  group.name = "game-markers";
  group.userData.isGameMarkerLayer = true;
  const layer = (points, geometry, material, options) => {
    if (!points?.length) return;
    group.add(createInstancedMarker(markerEntries(points, paired), geometry, material, options));
  };
  const ring = (inner, outer) => new THREE.RingGeometry(inner, outer, 40);

  const win = GAME_MARKER_STYLES.win;
  layer(markers.winLine, ring(1.0, 1.46), markerMaterial(win.haloColor, 0.36), {
    name: "win-halo",
    offset: surfaceOffset,
    scale: stoneRadius,
  });
  layer(markers.winLine, ring(1.0, 1.18), markerMaterial(win.color, 0.98), {
    name: "win-ring",
    offset: surfaceOffset + 0.002,
    scale: stoneRadius,
  });

  const flipped = GAME_MARKER_STYLES.flipped;
  layer(markers.flipped, ring(1.0, 1.15), markerMaterial(flipped.color, 0.9), {
    name: "flip-ring",
    offset: surfaceOffset + 0.001,
    scale: stoneRadius,
    flipRing: true,
  });

  const legal = GAME_MARKER_STYLES.legal[currentPlayer === "white" ? "white" : "black"];
  layer(
    markers.legal,
    new THREE.CircleGeometry(0.24, 28),
    markerMaterial(legal.color, legal.opacity),
    { name: "legal-dot", offset: surfaceOffset, scale: stoneRadius },
  );
  layer(
    markers.forbidden,
    createCrossGeometry(),
    markerMaterial(GAME_MARKER_STYLES.forbidden.color, 0.9),
    { name: "forbidden-cross", offset: raisedOffset, scale: stoneRadius },
  );

  updateGameMarkerLayer(group, { frameAt, flipWave });
  return group;
}

function updateMarkerMesh(mesh, frameAt, flipWave, now) {
  const waving = mesh.userData.flipRing && flipWave?.startedAt != null;
  const entries = mesh.userData.gameMarkerEntries ?? [];
  for (let index = 0; index < entries.length; index += 1) {
    const { row, col, sign = 1 } = entries[index];
    // A ring is hidden until its disc starts to turn, then grows in.
    const look = waving ? flipWave.look(row, col, now) : null;
    const growth = look ? Math.max(1e-4, look.ring) : 1;
    composeMarkerMatrix(frameAt(row, col), {
      sign,
      offset: mesh.userData.markerOffset ?? 0,
      scale: (mesh.userData.markerScale ?? 1) * growth,
    }, INSTANCE_MATRIX);
    mesh.setMatrixAt(index, INSTANCE_MATRIX);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

/**
 * Reposition the layer (the arc view slides its columns) and, with a running
 * flipWave, size each flip ring for its disc's turn.
 */
export function updateGameMarkerLayer(group, { frameAt, flipWave = null, now = currentTime() } = {}) {
  if (!group || typeof frameAt !== "function") return;
  for (const mesh of group.children) updateMarkerMesh(mesh, frameAt, flipWave, now);
}

/** Dispose a replaced layer without double-disposing shared resources. */
export function disposeGameMarkerLayer(group) {
  if (!group) return;
  group.removeFromParent();
  const geometries = new Set();
  const materials = new Set();
  group.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) materials.add(object.material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  group.clear();
}

/**
 * Owns one view's marker layer and forbidden-point hover cross. Views call
 * sync() from setPosition, reposition() when their layout slides, animate()
 * from their render callback (true while the flip wave still needs frames),
 * and show/hideForbiddenHover() from their hover refresh. Nothing is added to
 * the scene while there are no markers. The overlay owns the view's
 * FlipWave; views pose their turning stones from it (poseFlippingStones).
 */
export class GameMarkerOverlay {
  constructor({
    parent,
    frameAt,
    stoneRadius = 0.4,
    surfaceOffset = 0.058,
    raisedOffset = surfaceOffset,
    paired = false,
    reducedMotion = prefersReducedMotion(),
  } = {}) {
    if (typeof frameAt !== "function") throw new TypeError("frameAt must be a function");
    this.parent = parent;
    this.frameAt = frameAt;
    this.stoneRadius = stoneRadius;
    this.surfaceOffset = surfaceOffset;
    this.raisedOffset = raisedOffset;
    this.paired = paired;
    this.reducedMotion = reducedMotion;
    this.markers = EMPTY_GAME_MARKERS;
    this.signature = "";
    this.forbiddenKeys = new Set();
    this.group = null;
    this.hoverMarker = null;
    this.flipWave = new FlipWave({ reducedMotion });
  }

  /** Replace the markers; returns true when the scene changed. */
  sync(markers = EMPTY_GAME_MARKERS, { currentPlayer = "black", now = currentTime() } = {}) {
    const next = hasGameMarkers(markers) ? markers : EMPTY_GAME_MARKERS;
    const player = currentPlayer === "white" ? "white" : "black";
    const signature = hasGameMarkers(next)
      ? `${gameMarkersSignature(next)}#${next.legal.length > 0 ? player : ""}`
      : "";
    this.flipWave.sync(next.flipped, {
      origin: next.flipOrigin ?? null,
      animate: next.animateFlips === true,
      now,
    });
    if (signature === this.signature) return false;

    disposeGameMarkerLayer(this.group);
    this.markers = next;
    this.signature = signature;
    this.forbiddenKeys = new Set(next.forbidden.map(gameMarkerKey));
    this.group = createGameMarkerLayer(next, {
      frameAt: this.frameAt,
      stoneRadius: this.stoneRadius,
      surfaceOffset: this.surfaceOffset,
      raisedOffset: this.raisedOffset,
      paired: this.paired,
      currentPlayer: player,
      flipWave: this.flipWave,
    });
    if (this.group) this.parent?.add(this.group);
    if (this.forbiddenKeys.size === 0) this.hideForbiddenHover();
    return true;
  }

  reposition() {
    updateGameMarkerLayer(this.group, { frameAt: this.frameAt, flipWave: this.flipWave });
  }

  get animating() {
    return this.flipWave.startedAt !== null;
  }

  /** Advance the flip wave's rings; returns true while it needs another frame. */
  animate(now = currentTime()) {
    if (this.flipWave.startedAt === null) return false;
    const running = this.flipWave.running(now);
    const ringMesh = this.group?.getObjectByName("flip-ring");
    // After the last frame the rings settle at full size.
    if (ringMesh) updateMarkerMesh(ringMesh, this.frameAt, this.flipWave, now);
    return running;
  }

  isForbidden(point) {
    return Boolean(point) && this.forbiddenKeys.has(gameMarkerKey(point));
  }

  /** Show the hover cross on a forbidden point instead of a ghost stone. */
  showForbiddenHover(point) {
    if (!this.isForbidden(point)) return this.hideForbiddenHover();
    if (!this.hoverMarker) {
      const geometry = createCrossGeometry({ arm: 0.62, thickness: 0.1 });
      const material = markerMaterial(GAME_MARKER_STYLES.forbidden.hoverColor, 0.96);
      this.hoverMarker = new THREE.Group();
      this.hoverMarker.name = "forbidden-hover";
      for (const sign of this.paired ? [-1, 1] : [1]) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = 3;
        mesh.raycast = () => {};
        mesh.userData.sign = sign;
        this.hoverMarker.add(mesh);
      }
      this.parent?.add(this.hoverMarker);
    }
    const frame = this.frameAt(point.row, point.col);
    for (const mesh of this.hoverMarker.children) {
      composeMarkerMatrix(frame, {
        sign: mesh.userData.sign,
        offset: this.raisedOffset + 0.006,
        scale: this.stoneRadius,
      }, INSTANCE_MATRIX).decompose(mesh.position, mesh.quaternion, mesh.scale);
    }
    this.hoverMarker.visible = true;
    return true;
  }

  /** Hide the hover cross; returns true when it was visible. */
  hideForbiddenHover() {
    if (!this.hoverMarker?.visible) return false;
    this.hoverMarker.visible = false;
    return true;
  }

  dispose() {
    disposeGameMarkerLayer(this.group);
    this.group = null;
    if (this.hoverMarker) {
      const mesh = this.hoverMarker.children[0];
      mesh?.geometry.dispose();
      mesh?.material.dispose();
      this.hoverMarker.removeFromParent();
      this.hoverMarker.clear();
      this.hoverMarker = null;
    }
    this.markers = EMPTY_GAME_MARKERS;
    this.signature = "";
    this.forbiddenKeys = new Set();
    this.flipWave.cancel();
  }
}
