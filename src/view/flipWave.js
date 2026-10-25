import * as THREE from "three";

/**
 * The Othello flip wave: after a disc lands, the discs it outflanked turn
 * over one ring at a time, nearest first. Discs at the same distance from the
 * new disc turn together, so the wave runs out along every direction at once.
 *
 * The pure helpers give the timing and the look of one disc; FlipWave keeps
 * one view's running wave; poseFlippingStones turns the meshes of a 3D view.
 * Distances come from the Othello rules' view markers (othelloFlipOrder.js).
 */

/** The new disc lands before the first ring turns. */
export const FLIP_WAVE_DELAY_MS = 200;
/** From one ring of distance to the next. */
export const FLIP_WAVE_STEP_MS = 260;
/** One disc turning over. */
export const FLIP_TURN_MS = 440;
/** Long rays on big boards speed the rings up so a move never drags on. */
export const FLIP_WAVE_SPREAD_MAX_MS = 2_400;

function currentTime() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function maxDistance(flips) {
  let max = 0;
  for (const flip of flips ?? []) {
    const distance = Number.isInteger(flip?.distance) && flip.distance > 0 ? flip.distance : 1;
    if (distance > max) max = distance;
  }
  return max;
}

/** Time between rings for a wave whose farthest disc is `distance` away. */
export function flipWaveStepMs(distance) {
  if (!(distance > 1)) return FLIP_WAVE_STEP_MS;
  return Math.min(FLIP_WAVE_STEP_MS, FLIP_WAVE_SPREAD_MAX_MS / (distance - 1));
}

/** How long the whole wave of these flips lasts (0 without flips). */
export function flipWaveDurationMs(flips) {
  const distance = maxDistance(flips);
  if (distance === 0) return 0;
  return FLIP_WAVE_DELAY_MS + (distance - 1) * flipWaveStepMs(distance) + FLIP_TURN_MS;
}

/**
 * Progress of one disc's turn: below 0 it still waits (old colour), from 0 to
 * 1 it turns, and at 1 it is done.
 */
export function flipTurnProgress(distance, elapsed, stepMs = FLIP_WAVE_STEP_MS) {
  const ring = Number.isInteger(distance) && distance > 0 ? distance : 1;
  const start = FLIP_WAVE_DELAY_MS + (ring - 1) * stepMs;
  return Math.min(1, (elapsed - start) / FLIP_TURN_MS);
}

/**
 * The look of a disc at a turn progress: the angle it has turned about the
 * board (0 to pi), how high it is lifted (0 to 1, highest edge-on), its width
 * seen from above (1 flat, 0 edge-on), whether the new colour faces up yet,
 * and the outline ring's growth (0 to 1).
 */
export function flipTurnLook(progress) {
  if (!(progress > 0)) {
    return { angle: 0, lift: 0, squash: 1, showNewColor: false, ring: 0 };
  }
  const p = Math.min(1, progress);
  const eased = p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2;
  return {
    angle: Math.PI * eased,
    lift: Math.sin(Math.PI * eased),
    squash: Math.abs(Math.cos(Math.PI * eased)),
    showNewColor: eased >= 0.5,
    ring: p,
  };
}

function pointKey(row, col) {
  return `${row},${col}`;
}

/**
 * One view's flip wave. sync() starts a wave when the flipped discs change
 * and the page asks for animation (a move just played, not a jump through
 * history); otherwise the discs simply show their colour. look() is null for
 * a disc that is not turning (any more).
 */
export class FlipWave {
  constructor({ reducedMotion = false } = {}) {
    this.reducedMotion = reducedMotion;
    this.signature = "";
    this.startedAt = null;
    this.stepMs = FLIP_WAVE_STEP_MS;
    this.duration = 0;
    this.distances = new Map();
  }

  /**
   * @param {Array<{row: number, col: number, distance?: number}>} flipped
   * @param {{origin?: {row: number, col: number}|null, animate?: boolean, now?: number}} [options]
   * @returns {boolean} Whether a new wave started.
   */
  sync(flipped = [], { origin = null, animate = false, now = currentTime() } = {}) {
    const flips = Array.isArray(flipped) ? flipped : [];
    const signature = flips.length === 0
      ? ""
      : `${origin ? pointKey(origin.row, origin.col) : ""}>${flips.map((flip) => pointKey(flip.row, flip.col)).join(";")}`;
    if (signature === this.signature) return false;
    this.signature = signature;
    this.cancel();
    if (!animate || this.reducedMotion || flips.length === 0) return false;
    const farthest = maxDistance(flips);
    this.stepMs = flipWaveStepMs(farthest);
    this.duration = flipWaveDurationMs(flips);
    for (const flip of flips) {
      this.distances.set(
        pointKey(flip.row, flip.col),
        Number.isInteger(flip.distance) && flip.distance > 0 ? flip.distance : 1,
      );
    }
    this.startedAt = now;
    return true;
  }

  /** Stop the wave and forget its flips, so the same flips can start again. */
  reset() {
    this.signature = "";
    this.cancel();
  }

  /** Stop the wave; every disc shows its colour. */
  cancel() {
    this.startedAt = null;
    this.duration = 0;
    this.distances = new Map();
  }

  /** Whether the wave still needs frames; ends it once it is over. */
  running(now = currentTime()) {
    if (this.startedAt === null) return false;
    if (now - this.startedAt < this.duration) return true;
    this.cancel();
    return false;
  }

  has(row, col) {
    return this.startedAt !== null && this.distances.has(pointKey(row, col));
  }

  /** The look of a disc of the running wave, or null when it is not turning. */
  look(row, col, now = currentTime()) {
    if (this.startedAt === null) return null;
    const distance = this.distances.get(pointKey(row, col));
    if (distance === undefined) return null;
    const progress = flipTurnProgress(distance, now - this.startedAt, this.stepMs);
    if (progress >= 1) return null;
    return flipTurnLook(progress);
  }
}

const OPPOSITE = Object.freeze({ black: "white", white: "black" });
const LOCAL_UP = new THREE.Vector3(0, 1, 0);
const TURN_AXIS = new THREE.Vector3(1, 0, 0);
const TURN = new THREE.Quaternion();
const NORMAL = new THREE.Vector3();

/**
 * Pose the stones of a 3D view for the wave. Each entry {mesh, row, col,
 * color} is placed by the view's positionStone (stones lie with local Y on
 * the surface normal), then lifted along the normal and turned about a
 * tangent; it shows the old colour until it is edge-on. A disc that is not
 * turning gets its plain pose and colour.
 */
export function poseFlippingStones(entries, wave, { positionStone, materials, now = currentTime() }) {
  for (const entry of entries) {
    const look = wave.look(entry.row, entry.col, now);
    positionStone(entry.mesh, entry.row, entry.col);
    const shown = look && !look.showNewColor ? OPPOSITE[entry.color] : entry.color;
    entry.mesh.material = materials[shown] ?? entry.mesh.material;
    if (!look || look.angle === 0) continue;
    NORMAL.copy(LOCAL_UP).applyQuaternion(entry.mesh.quaternion);
    entry.mesh.position.addScaledVector(NORMAL, look.lift * entry.mesh.scale.x * 0.9);
    TURN.setFromAxisAngle(TURN_AXIS, look.angle);
    entry.mesh.quaternion.multiply(TURN);
  }
}
