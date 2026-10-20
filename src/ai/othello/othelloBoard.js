import { ROW_CLASSES } from "./othelloGeometry.js";

/**
 * Fast mutable Othello position for the AI search, on any topology.
 *
 * Cells hold 0 (empty), 1 (black) or 2 (white). Moves follow OthelloEngine
 * exactly: from the placed cell, each of the eight precomputed rays is
 * walked on the board as it was before the move, and the opponent discs of
 * a ray are flipped when the ray then reaches one of the mover's discs.
 * All eight runs are measured before anything flips (on a torus two rays
 * from one cell can cross the same cell), and a disc flips once.
 *
 * makeMove/unmakeMove keep, incrementally: the flip stack, disc counts, an
 * unordered list of empty cells, the number of occupied neighbours of each
 * cell (move generation only looks at empties next to a disc), disc counts
 * per row class and colour, the number of empty cells on each line (for
 * stable discs), and a 64-bit Zobrist hash in two 32-bit halves (side to
 * move not included).
 */

export const EMPTY_CELL = 0;
export const BLACK_DISC = 1;
export const WHITE_DISC = 2;

export class OthelloBoard {
  /** @param {ReturnType<import("./othelloGeometry.js").getOthelloGeometry>} geometry */
  constructor(geometry) {
    const cellCount = geometry.cellCount;
    this.geometry = geometry;
    this.cellCount = cellCount;
    this.cells = new Int8Array(cellCount);
    /** counts[1] black discs, counts[2] white discs, counts[0] empties. */
    this.counts = new Int32Array(3);
    this.emptyList = new Int16Array(cellCount);
    this.emptyPos = new Int16Array(cellCount);
    this.emptyCount = 0;
    this.occupiedNeighbors = new Uint8Array(cellCount);
    /** classCounts[colour * ROW_CLASSES + class]. */
    this.classCounts = new Int32Array(3 * ROW_CLASSES);
    this.lineEmpty = new Int16Array(geometry.lineCount);
    this.fullLines = 0;
    this.hashLo = 0;
    this.hashHi = 0;
    this.flipStack = new Int16Array(Math.max(1024, cellCount * 8));
    this.flipTop = 0;
    this.moveFlips = new Int32Array(cellCount + 8);
    this.moveCells = new Int16Array(cellCount + 8);
    this.moveSlots = new Int16Array(cellCount + 8);
    this.moveTop = 0;
    this.runEnds = new Int32Array(8);
    this.stableMark = new Int32Array(cellCount);
    this.stableStamp = 0;
    this.flipMark = new Int32Array(cellCount);
    this.flipStamp = 0;
    this.clear();
  }

  /** Empty every cell. */
  clear() {
    const { geometry } = this;
    this.cells.fill(0);
    this.counts[0] = this.cellCount;
    this.counts[1] = 0;
    this.counts[2] = 0;
    for (let cell = 0; cell < this.cellCount; cell += 1) {
      this.emptyList[cell] = cell;
      this.emptyPos[cell] = cell;
    }
    this.emptyCount = this.cellCount;
    this.occupiedNeighbors.fill(0);
    this.classCounts.fill(0);
    for (let cell = 0; cell < this.cellCount; cell += 1) {
      this.classCounts[geometry.rowClass[cell]] += 1;
    }
    this.lineEmpty.fill(0);
    for (let slot = 0; slot < geometry.lineOf.length; slot += 1) {
      this.lineEmpty[geometry.lineOf[slot]] += 1;
    }
    this.fullLines = 0;
    this.hashLo = 0;
    this.hashHi = 0;
    this.flipTop = 0;
    this.moveTop = 0;
  }

  /**
   * Load a position: `values[cell]` is 0, 1 or 2 (row-major).
   * @param {ArrayLike<number>} values
   */
  load(values) {
    this.clear();
    for (let cell = 0; cell < this.cellCount; cell += 1) {
      if (values[cell] !== 0) this.#place(cell, values[cell]);
    }
  }

  /** Load from OthelloEngine-style rows of "black" | "white" | null. */
  loadRows(rows) {
    const { width } = this.geometry;
    const values = new Int8Array(this.cellCount);
    rows.forEach((row, rowIndex) => {
      row.forEach((value, col) => {
        values[rowIndex * width + col] =
          value === "black" ? BLACK_DISC : value === "white" ? WHITE_DISC : EMPTY_CELL;
      });
    });
    this.load(values);
  }

  /**
   * Put a disc on an empty cell without flipping (bookkeeping only).
   * Returns the empty-list slot the cell had, for #unplace.
   */
  #place(cell, color) {
    const geometry = this.geometry;
    this.cells[cell] = color;
    this.counts[color] += 1;
    this.counts[0] -= 1;
    // Remove from the empty list by swapping in the last entry.
    const position = this.emptyPos[cell];
    const last = this.emptyList[this.emptyCount - 1];
    this.emptyList[position] = last;
    this.emptyPos[last] = position;
    this.emptyList[this.emptyCount - 1] = cell;
    this.emptyPos[cell] = this.emptyCount - 1;
    this.emptyCount -= 1;
    const { neighborStart, neighbors, lineOf } = geometry;
    for (let index = neighborStart[cell]; index < neighborStart[cell + 1]; index += 1) {
      this.occupiedNeighbors[neighbors[index]] += 1;
    }
    const rowClass = geometry.rowClass[cell];
    this.classCounts[rowClass] -= 1;
    this.classCounts[color * ROW_CLASSES + rowClass] += 1;
    for (let axis = 0; axis < 4; axis += 1) {
      const line = lineOf[cell * 4 + axis];
      if ((this.lineEmpty[line] -= 1) === 0) this.fullLines += 1;
    }
    this.hashLo ^= geometry.zobristLo[cell * 2 + color - 1];
    this.hashHi ^= geometry.zobristHi[cell * 2 + color - 1];
    return position;
  }

  /**
   * Undo #place of the most recently placed cell, which had empty-list slot
   * `position`; the list order is restored exactly.
   */
  #unplace(cell, color, position) {
    const geometry = this.geometry;
    this.cells[cell] = 0;
    this.counts[color] -= 1;
    this.counts[0] += 1;
    // #place parked `cell` just past the live part of the list (later
    // placements only touch earlier slots) and moved the last entry into
    // its slot; swap them back.
    const end = this.emptyCount;
    const moved = this.emptyList[position];
    this.emptyList[end] = moved;
    this.emptyPos[moved] = end;
    this.emptyList[position] = cell;
    this.emptyPos[cell] = position;
    this.emptyCount = end + 1;
    const { neighborStart, neighbors, lineOf } = geometry;
    for (let index = neighborStart[cell]; index < neighborStart[cell + 1]; index += 1) {
      this.occupiedNeighbors[neighbors[index]] -= 1;
    }
    const rowClass = geometry.rowClass[cell];
    this.classCounts[rowClass] += 1;
    this.classCounts[color * ROW_CLASSES + rowClass] -= 1;
    for (let axis = 0; axis < 4; axis += 1) {
      const line = lineOf[cell * 4 + axis];
      if (this.lineEmpty[line]++ === 0) this.fullLines -= 1;
    }
    this.hashLo ^= geometry.zobristLo[cell * 2 + color - 1];
    this.hashHi ^= geometry.zobristHi[cell * 2 + color - 1];
  }

  /** Whether `color` may play the empty cell (it flips at least one disc). */
  isLegal(cell, color) {
    if (this.cells[cell] !== 0 || this.occupiedNeighbors[cell] === 0) return false;
    const { rayStart, rayCells } = this.geometry;
    const cells = this.cells;
    const opponent = 3 - color;
    const base = cell * 8;
    for (let direction = 0; direction < 8; direction += 1) {
      let index = rayStart[base + direction];
      const end = rayStart[base + direction + 1];
      if (end - index < 2 || cells[rayCells[index]] !== opponent) continue;
      index += 1;
      while (index < end && cells[rayCells[index]] === opponent) index += 1;
      if (index < end && cells[rayCells[index]] === color) return true;
    }
    return false;
  }

  /**
   * Write the legal moves of `color` into `out` (an Int16Array of at least
   * emptyCount entries) and return how many there are.
   */
  generateMoves(color, out) {
    const { rayStart, rayCells } = this.geometry;
    const cells = this.cells;
    const occupied = this.occupiedNeighbors;
    const emptyList = this.emptyList;
    const opponent = 3 - color;
    let count = 0;
    for (let slot = 0; slot < this.emptyCount; slot += 1) {
      const cell = emptyList[slot];
      if (occupied[cell] === 0) continue;
      const base = cell * 8;
      for (let direction = 0; direction < 8; direction += 1) {
        let index = rayStart[base + direction];
        const end = rayStart[base + direction + 1];
        if (end - index < 2 || cells[rayCells[index]] !== opponent) continue;
        index += 1;
        while (index < end && cells[rayCells[index]] === opponent) index += 1;
        if (index < end && cells[rayCells[index]] === color) {
          out[count] = cell;
          count += 1;
          break;
        }
      }
    }
    return count;
  }

  /** Number of legal moves for `color`. */
  countMoves(color) {
    const { rayStart, rayCells } = this.geometry;
    const cells = this.cells;
    const occupied = this.occupiedNeighbors;
    const emptyList = this.emptyList;
    const opponent = 3 - color;
    let count = 0;
    for (let slot = 0; slot < this.emptyCount; slot += 1) {
      const cell = emptyList[slot];
      if (occupied[cell] === 0) continue;
      const base = cell * 8;
      for (let direction = 0; direction < 8; direction += 1) {
        let index = rayStart[base + direction];
        const end = rayStart[base + direction + 1];
        if (end - index < 2 || cells[rayCells[index]] !== opponent) continue;
        index += 1;
        while (index < end && cells[rayCells[index]] === opponent) index += 1;
        if (index < end && cells[rayCells[index]] === color) {
          count += 1;
          break;
        }
      }
    }
    return count;
  }

  /** Whether `color` has any legal move. */
  hasMove(color) {
    const emptyList = this.emptyList;
    for (let slot = 0; slot < this.emptyCount; slot += 1) {
      if (this.isLegal(emptyList[slot], color)) return true;
    }
    return false;
  }

  /**
   * Play `color` on the empty `cell`. Returns the number of discs flipped;
   * 0 means the move was illegal and nothing changed.
   */
  makeMove(cell, color) {
    if (this.cells[cell] !== 0) return 0;
    const geometry = this.geometry;
    const { rayStart, rayCells } = geometry;
    const cells = this.cells;
    const opponent = 3 - color;
    const runEnds = this.runEnds;
    const base = cell * 8;
    let any = false;
    // Measure every run on the unchanged board first.
    for (let direction = 0; direction < 8; direction += 1) {
      const start = rayStart[base + direction];
      const end = rayStart[base + direction + 1];
      let index = start;
      while (index < end && cells[rayCells[index]] === opponent) index += 1;
      if (index > start && index < end && cells[rayCells[index]] === color) {
        runEnds[direction] = index;
        any = true;
      } else {
        runEnds[direction] = start;
      }
    }
    if (!any) return 0;
    const flipStack = this.flipStack;
    if (this.flipTop + this.cellCount > flipStack.length) {
      const grown = new Int16Array(flipStack.length * 2);
      grown.set(flipStack);
      this.flipStack = grown;
    }
    const stack = this.flipStack;
    const { flipLo, flipHi, rowClass } = geometry;
    const classCounts = this.classCounts;
    let top = this.flipTop;
    let hashLo = this.hashLo;
    let hashHi = this.hashHi;
    for (let direction = 0; direction < 8; direction += 1) {
      const end = runEnds[direction];
      for (let index = rayStart[base + direction]; index < end; index += 1) {
        const disc = rayCells[index];
        // Already flipped by an earlier ray of this move.
        if (cells[disc] !== opponent) continue;
        cells[disc] = color;
        stack[top] = disc;
        top += 1;
        hashLo ^= flipLo[disc];
        hashHi ^= flipHi[disc];
        const discClass = rowClass[disc];
        classCounts[color * ROW_CLASSES + discClass] += 1;
        classCounts[opponent * ROW_CLASSES + discClass] -= 1;
      }
    }
    const flipped = top - this.flipTop;
    this.flipTop = top;
    this.hashLo = hashLo;
    this.hashHi = hashHi;
    this.counts[color] += flipped;
    this.counts[opponent] -= flipped;
    this.moveFlips[this.moveTop] = flipped;
    this.moveCells[this.moveTop] = cell;
    this.moveSlots[this.moveTop] = this.#place(cell, color);
    this.moveTop += 1;
    return flipped;
  }

  /** Undo the latest makeMove (which `color` played). */
  unmakeMove(color) {
    this.moveTop -= 1;
    const cell = this.moveCells[this.moveTop];
    const flipped = this.moveFlips[this.moveTop];
    const opponent = 3 - color;
    this.#unplace(cell, color, this.moveSlots[this.moveTop]);
    const geometry = this.geometry;
    const { flipLo, flipHi, rowClass } = geometry;
    const stack = this.flipStack;
    const cells = this.cells;
    const classCounts = this.classCounts;
    let hashLo = this.hashLo;
    let hashHi = this.hashHi;
    const bottom = this.flipTop - flipped;
    for (let index = this.flipTop - 1; index >= bottom; index -= 1) {
      const disc = stack[index];
      cells[disc] = opponent;
      hashLo ^= flipLo[disc];
      hashHi ^= flipHi[disc];
      const discClass = rowClass[disc];
      classCounts[color * ROW_CLASSES + discClass] -= 1;
      classCounts[opponent * ROW_CLASSES + discClass] += 1;
    }
    this.flipTop = bottom;
    this.hashLo = hashLo;
    this.hashHi = hashHi;
    this.counts[color] -= flipped;
    this.counts[opponent] += flipped;
  }

  /**
   * Whether `color` may play the empty cell, without the occupied-neighbour
   * shortcut (valid between lean moves, which do not maintain it).
   */
  isLegalLean(cell, color) {
    const { rayStart, rayCells } = this.geometry;
    const cells = this.cells;
    const opponent = 3 - color;
    const base = cell * 8;
    for (let direction = 0; direction < 8; direction += 1) {
      let index = rayStart[base + direction];
      const end = rayStart[base + direction + 1];
      if (end - index < 2 || cells[rayCells[index]] !== opponent) continue;
      index += 1;
      while (index < end && cells[rayCells[index]] === opponent) index += 1;
      if (index < end && cells[rayCells[index]] === color) return true;
    }
    return false;
  }

  /**
   * Number of discs `color` would flip on the empty cell (0: illegal),
   * changing nothing. Rays from one cell can cross on some boards (torus
   * diagonals, tall cylinders); such cells count once.
   */
  countFlips(cell, color) {
    const geometry = this.geometry;
    const { rayStart, rayCells } = geometry;
    const cells = this.cells;
    const opponent = 3 - color;
    const base = cell * 8;
    let total = 0;
    if (!geometry.raysCross) {
      for (let direction = 0; direction < 8; direction += 1) {
        const start = rayStart[base + direction];
        const end = rayStart[base + direction + 1];
        let index = start;
        while (index < end && cells[rayCells[index]] === opponent) index += 1;
        if (index > start && index < end && cells[rayCells[index]] === color) {
          total += index - start;
        }
      }
      return total;
    }
    this.flipStamp += 1;
    if (this.flipStamp > 0x3fffffff) {
      this.flipMark.fill(0);
      this.flipStamp = 1;
    }
    const stamp = this.flipStamp;
    const mark = this.flipMark;
    for (let direction = 0; direction < 8; direction += 1) {
      const start = rayStart[base + direction];
      const end = rayStart[base + direction + 1];
      let index = start;
      while (index < end && cells[rayCells[index]] === opponent) index += 1;
      if (index > start && index < end && cells[rayCells[index]] === color) {
        for (let at = start; at < index; at += 1) {
          const disc = rayCells[at];
          if (mark[disc] !== stamp) {
            mark[disc] = stamp;
            total += 1;
          }
        }
      }
    }
    return total;
  }

  /**
   * Legal moves of `color` among the cells of the empty list that are still
   * empty (valid after lean moves, which leave the list alone).
   */
  countMovesLean(color) {
    const cells = this.cells;
    const emptyList = this.emptyList;
    let count = 0;
    for (let slot = 0; slot < this.emptyCount; slot += 1) {
      const cell = emptyList[slot];
      if (cells[cell] === 0 && this.isLegalLean(cell, color)) count += 1;
    }
    return count;
  }

  /**
   * makeMove for exact solving of the last few empties: flips discs and
   * keeps disc counts, nothing else (no hash, empty list, neighbour counts,
   * row classes or lines). Only lean calls may run until the matching
   * unmakeMoveLean calls have restored the position.
   */
  makeMoveLean(cell, color) {
    const { rayStart, rayCells } = this.geometry;
    const cells = this.cells;
    const opponent = 3 - color;
    const runEnds = this.runEnds;
    const base = cell * 8;
    let any = false;
    for (let direction = 0; direction < 8; direction += 1) {
      const start = rayStart[base + direction];
      const end = rayStart[base + direction + 1];
      let index = start;
      while (index < end && cells[rayCells[index]] === opponent) index += 1;
      if (index > start && index < end && cells[rayCells[index]] === color) {
        runEnds[direction] = index;
        any = true;
      } else {
        runEnds[direction] = start;
      }
    }
    if (!any) return 0;
    if (this.flipTop + this.cellCount > this.flipStack.length) {
      const grown = new Int16Array(this.flipStack.length * 2);
      grown.set(this.flipStack);
      this.flipStack = grown;
    }
    const stack = this.flipStack;
    let top = this.flipTop;
    for (let direction = 0; direction < 8; direction += 1) {
      const end = runEnds[direction];
      for (let index = rayStart[base + direction]; index < end; index += 1) {
        const disc = rayCells[index];
        if (cells[disc] !== opponent) continue;
        cells[disc] = color;
        stack[top] = disc;
        top += 1;
      }
    }
    const flipped = top - this.flipTop;
    this.flipTop = top;
    cells[cell] = color;
    this.counts[color] += flipped + 1;
    this.counts[opponent] -= flipped;
    this.counts[0] -= 1;
    this.moveFlips[this.moveTop] = flipped;
    this.moveCells[this.moveTop] = cell;
    this.moveTop += 1;
    return flipped;
  }

  /** Undo the latest makeMoveLean (which `color` played). */
  unmakeMoveLean(color) {
    this.moveTop -= 1;
    const cell = this.moveCells[this.moveTop];
    const flipped = this.moveFlips[this.moveTop];
    const opponent = 3 - color;
    const stack = this.flipStack;
    const cells = this.cells;
    const bottom = this.flipTop - flipped;
    for (let index = bottom; index < this.flipTop; index += 1) cells[stack[index]] = opponent;
    this.flipTop = bottom;
    cells[cell] = 0;
    this.counts[color] -= flipped + 1;
    this.counts[opponent] += flipped;
    this.counts[0] += 1;
  }

  /** Cells flipped by the latest makeMove, in flip order. */
  lastFlips() {
    const flipped = this.moveFlips[this.moveTop - 1];
    return Array.from(this.flipStack.subarray(this.flipTop - flipped, this.flipTop));
  }

  /** Recompute the hash from scratch (tests). */
  computeHash() {
    const { zobristLo, zobristHi } = this.geometry;
    let lo = 0;
    let hi = 0;
    for (let cell = 0; cell < this.cellCount; cell += 1) {
      const color = this.cells[cell];
      if (color === 0) continue;
      lo ^= zobristLo[cell * 2 + color - 1];
      hi ^= zobristHi[cell * 2 + color - 1];
    }
    return [lo, hi];
  }

  /**
   * Count stable discs of each colour into out[1], out[2]. A disc is stable
   * when, along each of its four lines, the line is full, the disc ends the
   * line (a boundary row), or an adjacent disc on that line is a stable disc
   * of the same colour. Every row wraps on these boards, so nothing is
   * stable until some line is full.
   */
  stableDiscs(out) {
    out[1] = 0;
    out[2] = 0;
    if (this.fullLines === 0) return out;
    const geometry = this.geometry;
    const { lineOf, axisNeighbor } = geometry;
    const cells = this.cells;
    const stable = this.stableMark;
    // A fresh stamp marks this call's stable discs without clearing.
    this.stableStamp += 1;
    if (this.stableStamp > 0x3fffffff) {
      stable.fill(0);
      this.stableStamp = 1;
    }
    const stamp = this.stableStamp;
    let changed = true;
    while (changed) {
      changed = false;
      for (let cell = 0; cell < this.cellCount; cell += 1) {
        const color = cells[cell];
        if (color === 0 || stable[cell] === stamp) continue;
        let ok = true;
        for (let axis = 0; axis < 4 && ok; axis += 1) {
          if (this.lineEmpty[lineOf[cell * 4 + axis]] === 0) continue;
          const forward = axisNeighbor[cell * 8 + axis * 2];
          const backward = axisNeighbor[cell * 8 + axis * 2 + 1];
          if (forward < 0 || backward < 0) continue;
          if (cells[forward] === color && stable[forward] === stamp) continue;
          if (cells[backward] === color && stable[backward] === stamp) continue;
          ok = false;
        }
        if (ok) {
          stable[cell] = stamp;
          out[color] += 1;
          changed = true;
        }
      }
    }
    return out;
  }
}
