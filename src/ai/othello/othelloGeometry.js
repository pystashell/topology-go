import { AXES, DIRECTIONS_8, getTopology } from "../../topology/index.js";

/**
 * Precomputed tables for the Othello AI on one board shape (topology kind,
 * width, height). Everything is derived from topology.step()/ray()/line(), so
 * the AI follows exactly the walks OthelloEngine makes:
 *
 * - rays: for every cell and each of the eight DIRECTIONS_8, the cells
 *   topology.ray() visits (a ray stops at a boundary row, or just before it
 *   would re-enter its start cell; it never includes the start). Cells are
 *   stored nearest first in one flat Int16Array.
 * - neighbours: the distinct king-move neighbours of each cell.
 * - lines: every straight line (topology.line) gets an id; each cell knows
 *   the line it lies on along each of the four AXES (taken in the cell's own
 *   frame, so a Mobius diagonal that continues as the other diagonal after
 *   the seam is one line). Used for stable-disc detection.
 * - rowClass: distance to the nearest boundary row (cylinder, Mobius), the
 *   only places where discs gain positional value; the torus has none.
 * - Zobrist keys (two 32-bit halves per cell and colour, plus side to move)
 *   from a fixed seed, so hashes are reproducible.
 *
 * Geometries are memoized (a few shapes) and must be treated as read-only.
 */

/** Number of row classes: 0 boundary row, 1 next to it, 2 two away, 3 rest. */
export const ROW_CLASSES = 4;

const CACHE_LIMIT = 6;
const cache = new Map();

/** Deterministic 32-bit PRNG (mulberry32). */
export function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt32(random) {
  return (Math.floor(random() * 4294967296) | 0);
}

function directionIndex(dRow, dCol) {
  for (let direction = 0; direction < 8; direction += 1) {
    if (DIRECTIONS_8[direction][0] === dRow && DIRECTIONS_8[direction][1] === dCol) {
      return direction;
    }
  }
  throw new Error(`Not a unit direction: ${dRow},${dCol}`);
}

function axisIndex(dRow, dCol) {
  for (let axis = 0; axis < AXES.length; axis += 1) {
    const [aRow, aCol] = AXES[axis];
    if ((aRow === dRow && aCol === dCol) || (aRow === -dRow && aCol === -dCol)) {
      return axis;
    }
  }
  return -1;
}

function buildGeometry(kind, width, height) {
  const topology = getTopology(kind, width, height);
  const cellCount = width * height;
  if (cellCount > 32767) throw new RangeError("Board too large for the Othello AI");

  // One topology.step() per (cell, direction): the directed state reached,
  // as cell * 8 + direction of travel on arrival, or -1 past a boundary.
  const nextState = new Int32Array(cellCount * 8);
  for (let cell = 0; cell < cellCount; cell += 1) {
    const row = Math.floor(cell / width);
    const col = cell - row * width;
    for (let direction = 0; direction < 8; direction += 1) {
      const [dRow, dCol] = DIRECTIONS_8[direction];
      const next = topology.step(row, col, dRow, dCol);
      nextState[cell * 8 + direction] =
        next === null
          ? -1
          : (next.row * width + next.col) * 8 + directionIndex(next.dRow, next.dCol);
    }
  }

  // Rays in DIRECTIONS_8 order, walked exactly like topology.ray(): stop at
  // a boundary or just before re-entering the start cell.
  const maxSteps = 2 * cellCount;
  const rayStart = new Int32Array(cellCount * 8 + 1);
  let rayCells = new Int16Array(cellCount * 64);
  let rayLength = 0;
  let raysRevisitCells = false;
  const seen = new Int32Array(cellCount).fill(-1);
  for (let cell = 0; cell < cellCount; cell += 1) {
    for (let direction = 0; direction < 8; direction += 1) {
      const ray = cell * 8 + direction;
      rayStart[ray] = rayLength;
      let state = nextState[ray];
      let steps = 0;
      while (state >= 0 && state >>> 3 !== cell) {
        if (steps === maxSteps) throw new Error("Unexpected unbounded Othello ray");
        const index = state >>> 3;
        if (seen[index] === ray) raysRevisitCells = true;
        seen[index] = ray;
        if (rayLength === rayCells.length) {
          const grown = new Int16Array(rayCells.length * 2);
          grown.set(rayCells);
          rayCells = grown;
        }
        rayCells[rayLength] = index;
        rayLength += 1;
        steps += 1;
        state = nextState[state];
      }
    }
  }
  rayStart[cellCount * 8] = rayLength;
  rayCells = rayCells.slice(0, rayLength);

  // Whether two rays from one cell can share a cell (torus diagonals, tall
  // cylinders): then flips must be deduplicated when counted.
  let raysCross = raysRevisitCells;
  const owner = new Int32Array(cellCount).fill(-1);
  for (let cell = 0; cell < cellCount && !raysCross; cell += 1) {
    for (let index = rayStart[cell * 8]; index < rayStart[cell * 8 + 8]; index += 1) {
      if (owner[rayCells[index]] === cell) {
        raysCross = true;
        break;
      }
      owner[rayCells[index]] = cell;
    }
  }

  // Distinct neighbours (CSR).
  const neighborStart = new Int32Array(cellCount + 1);
  const neighborList = [];
  for (let cell = 0; cell < cellCount; cell += 1) {
    neighborStart[cell] = neighborList.length;
    const row = Math.floor(cell / width);
    for (const point of topology.neighbors8(row, cell - row * width)) {
      neighborList.push(point.row * width + point.col);
    }
  }
  neighborStart[cellCount] = neighborList.length;
  const neighbors = Int16Array.from(neighborList);

  // Lines along the four axes, and each cell's axis neighbours.
  const lineOf = new Int32Array(cellCount * 4).fill(-1);
  const axisNeighbor = new Int16Array(cellCount * 8).fill(-1);
  const lineLengths = [];
  for (let cell = 0; cell < cellCount; cell += 1) {
    const row = Math.floor(cell / width);
    const col = cell - row * width;
    for (let axis = 0; axis < 4; axis += 1) {
      const [dRow, dCol] = AXES[axis];
      const forward = topology.step(row, col, dRow, dCol);
      const backward = topology.step(row, col, -dRow, -dCol);
      axisNeighbor[cell * 8 + axis * 2] = forward ? forward.row * width + forward.col : -1;
      axisNeighbor[cell * 8 + axis * 2 + 1] = backward
        ? backward.row * width + backward.col
        : -1;
      if (lineOf[cell * 4 + axis] >= 0) continue;
      const id = lineLengths.length;
      const { cells } = topology.line(row, col, dRow, dCol);
      let members = 0;
      for (const point of cells) {
        const pointAxis = axisIndex(point.dRow, point.dCol);
        const slot = (point.row * width + point.col) * 4 + pointAxis;
        if (pointAxis < 0 || lineOf[slot] >= 0) continue;
        lineOf[slot] = id;
        members += 1;
      }
      lineLengths.push(members);
    }
  }
  const lineCount = lineLengths.length;
  const lineLength = Int16Array.from(lineLengths);

  // Row classes: distance to a boundary row, capped. The torus has no
  // boundary, so every cell is in the neutral class.
  const rowClass = new Uint8Array(cellCount);
  for (let cell = 0; cell < cellCount; cell += 1) {
    const row = Math.floor(cell / width);
    rowClass[cell] =
      kind === "torus" ? ROW_CLASSES - 1 : Math.min(row, height - 1 - row, ROW_CLASSES - 1);
  }
  const rowClassSize = new Int32Array(ROW_CLASSES);
  for (let cell = 0; cell < cellCount; cell += 1) rowClassSize[rowClass[cell]] += 1;

  // Zobrist keys: index cell * 2 + (colour - 1); colour 1 black, 2 white.
  const random = createRandom(0x07e110 ^ (width * 977 + height * 131 + kind.length));
  const zobristLo = new Int32Array(cellCount * 2);
  const zobristHi = new Int32Array(cellCount * 2);
  for (let index = 0; index < cellCount * 2; index += 1) {
    zobristLo[index] = randomInt32(random);
    zobristHi[index] = randomInt32(random);
  }
  const flipLo = new Int32Array(cellCount);
  const flipHi = new Int32Array(cellCount);
  for (let cell = 0; cell < cellCount; cell += 1) {
    flipLo[cell] = zobristLo[cell * 2] ^ zobristLo[cell * 2 + 1];
    flipHi[cell] = zobristHi[cell * 2] ^ zobristHi[cell * 2 + 1];
  }

  return Object.freeze({
    kind,
    width,
    height,
    cellCount,
    hasBoundary: kind !== "torus",
    rayStart,
    rayCells,
    raysRevisitCells,
    raysCross,
    neighborStart,
    neighbors,
    lineOf,
    lineCount,
    lineLength,
    axisNeighbor,
    rowClass,
    rowClassSize,
    zobristLo,
    zobristHi,
    flipLo,
    flipHi,
    sideLo: randomInt32(random),
    sideHi: randomInt32(random),
  });
}

/**
 * The shared tables for a board shape.
 *
 * @param {'cylinder'|'torus'|'mobius'} kind
 * @param {number} width
 * @param {number} height
 */
export function getOthelloGeometry(kind, width, height) {
  const key = `${kind}:${width}x${height}`;
  let geometry = cache.get(key);
  if (geometry) {
    cache.delete(key);
    cache.set(key, geometry);
    return geometry;
  }
  geometry = buildGeometry(kind, width, height);
  cache.set(key, geometry);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return geometry;
}
