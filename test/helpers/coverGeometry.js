/**
 * Board geometry for the test references, written from the "cover" picture
 * and sharing no code with src/topology: a board is one copy of an infinite
 * strip of copies laid side by side. Cylinder copies repeat; a torus also
 * repeats up and down; a Mobius strip turns every other copy over (row r of
 * an odd copy is row height-1-r of the board). Rows outside the strip are off
 * the board except on a torus.
 */

export const TOPOLOGY_KINDS = Object.freeze(["cylinder", "torus", "mobius"]);
export const AXES_4 = Object.freeze([[0, 1], [1, 0], [1, 1], [1, -1]]);
export const ORTHOGONAL = Object.freeze([[-1, 0], [1, 0], [0, -1], [0, 1]]);

export function mod(value, size) {
  return ((value % size) + size) % size;
}

/** The board cell at cover position (R, C), or null off the strip. */
export function coverCell(kind, width, height, R, C) {
  if (kind === "torus") return { row: mod(R, height), col: mod(C, width) };
  if (R < 0 || R >= height) return null;
  const col = mod(C, width);
  if (kind === "cylinder") return { row: R, col };
  const turnedOver = mod(Math.floor(C / width), 2) === 1;
  return { row: turnedOver ? height - 1 - R : R, col };
}

/** The distinct orthogonal neighbours of a board cell. */
export function neighbours4(kind, width, height, row, col) {
  const seen = new Set();
  const cells = [];
  for (const [dRow, dCol] of ORTHOGONAL) {
    const cell = coverCell(kind, width, height, row + dRow, col + dCol);
    if (!cell) continue;
    const key = cell.row * width + cell.col;
    if (seen.has(key) || key === row * width + col) continue;
    seen.add(key);
    cells.push(cell);
  }
  return cells;
}

/** A seeded random number generator (LCG) returning [0, 1). */
export function seededRandom(seed) {
  let state = (seed * 2654435761) >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

export function shuffled(values, random) {
  const copy = values.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}
