import { neighbours4 } from "./coverGeometry.js";

/**
 * An independent Go referee for the soak tests. It shares no code with
 * src/game/goEngine.js: boards are flat arrays of "B", "W" and ".", groups
 * are flood-filled from coverGeometry's neighbours, and positional superko
 * keeps every whole-board arrangement of the current line of play (the
 * start included; passes add nothing). undo() pops the line.
 */

const OTHER = { B: "W", W: "B" };
export const REF_COLOR = { black: "B", white: "W" };
export const ENGINE_COLOR = { B: "black", W: "white", ".": null };

export class GoReference {
  constructor({ width, height, topology, komi = 7.5 }) {
    this.width = width;
    this.height = height;
    this.topology = topology;
    this.komi = komi;
    this.cells = Array(width * height).fill(".");
    this.toMove = "B";
    this.captures = { B: 0, W: 0 };
    this.passes = 0;
    this.neighbourList = Array.from({ length: width * height }, (_, index) =>
      neighbours4(topology, width, height, Math.floor(index / width), index % width)
        .map(({ row, col }) => row * width + col));
    this.history = new Map([[this.key(this.cells), 1]]);
    this.line = [];
  }

  key(cells) {
    return cells.join("");
  }

  group(cells, start) {
    const color = cells[start];
    const stones = [start];
    const seen = new Set(stones);
    const liberties = new Set();
    for (let index = 0; index < stones.length; index += 1) {
      for (const next of this.neighbourList[stones[index]]) {
        if (cells[next] === ".") liberties.add(next);
        else if (cells[next] === color && !seen.has(next)) {
          seen.add(next);
          stones.push(next);
        }
      }
    }
    return { stones, liberties };
  }

  /** The outcome of `color` playing at index, without changing anything. */
  attempt(index, color = this.toMove) {
    if (this.cells[index] !== ".") return { ok: false, reason: "occupied" };
    const cells = this.cells.slice();
    cells[index] = color;
    const captured = [];
    for (const next of this.neighbourList[index]) {
      if (cells[next] !== OTHER[color]) continue;
      const group = this.group(cells, next);
      if (group.liberties.size > 0) continue;
      for (const stone of group.stones) {
        if (cells[stone] !== ".") captured.push(stone);
        cells[stone] = ".";
      }
    }
    if (this.group(cells, index).liberties.size === 0) return { ok: false, reason: "suicide" };
    const key = this.key(cells);
    if (this.history.has(key)) return { ok: false, reason: "superko", key };
    return { ok: true, cells, captured, key };
  }

  play(index) {
    const result = this.attempt(index);
    if (!result.ok) return result;
    this.line.push({ cells: this.cells, toMove: this.toMove, captures: { ...this.captures }, passes: this.passes, key: result.key });
    this.cells = result.cells;
    this.captures[this.toMove] += result.captured.length;
    this.history.set(result.key, (this.history.get(result.key) ?? 0) + 1);
    this.toMove = OTHER[this.toMove];
    this.passes = 0;
    return result;
  }

  pass() {
    this.line.push({ cells: this.cells, toMove: this.toMove, captures: { ...this.captures }, passes: this.passes, key: null });
    this.toMove = OTHER[this.toMove];
    this.passes += 1;
  }

  undo() {
    const entry = this.line.pop();
    if (!entry) return false;
    if (entry.key !== null) {
      const count = this.history.get(entry.key) - 1;
      if (count === 0) this.history.delete(entry.key);
      else this.history.set(entry.key, count);
    }
    this.cells = entry.cells;
    this.toMove = entry.toMove;
    this.captures = entry.captures;
    this.passes = entry.passes;
    return true;
  }

  /** Whether index is an empty point whose neighbours are all `color`. */
  isOwnEye(index, color = this.toMove) {
    return this.cells[index] === "." && this.neighbourList[index].every((next) => this.cells[next] === color);
  }

  /** The engine-shaped board. */
  board() {
    return Array.from({ length: this.height }, (_, row) =>
      this.cells.slice(row * this.width, (row + 1) * this.width).map((value) => ENGINE_COLOR[value]));
  }

  /**
   * The engine's conservative dead-stone suggestion, restated: a group in
   * atari whose owner cannot play its last liberty (suicide, superko ignored)
   * while the opponent can (superko respected) is dead.
   */
  suggestedDead() {
    const dead = new Set();
    const seen = new Set();
    for (let index = 0; index < this.cells.length; index += 1) {
      if (this.cells[index] === "." || seen.has(index)) continue;
      const color = this.cells[index];
      const group = this.group(this.cells, index);
      for (const stone of group.stones) seen.add(stone);
      if (group.liberties.size !== 1) continue;
      const [liberty] = group.liberties;
      const defence = this.attempt(liberty, color);
      if (defence.ok || defence.reason === "superko") continue;
      const capture = this.attempt(liberty, OTHER[color]);
      if (!capture.ok) continue;
      for (const stone of group.stones) dead.add(stone);
    }
    return dead;
  }

  /** Territory ("japanese") and area ("chinese") scores with `dead` removed. */
  score(dead, rule) {
    const cells = this.cells.slice();
    const deadCount = { B: 0, W: 0 };
    for (const index of dead) {
      deadCount[cells[index]] += 1;
      cells[index] = ".";
    }
    const territory = { B: 0, W: 0 };
    const stones = { B: 0, W: 0 };
    const seen = new Set();
    let neutral = 0;
    for (let index = 0; index < cells.length; index += 1) {
      if (cells[index] !== ".") {
        stones[cells[index]] += 1;
        continue;
      }
      if (seen.has(index)) continue;
      const region = [index];
      seen.add(index);
      const borders = new Set();
      for (let at = 0; at < region.length; at += 1) {
        for (const next of this.neighbourList[region[at]]) {
          if (cells[next] === ".") {
            if (!seen.has(next)) {
              seen.add(next);
              region.push(next);
            }
          } else borders.add(cells[next]);
        }
      }
      if (borders.size === 1) territory[[...borders][0]] += region.length;
      else neutral += region.length;
    }
    const black = rule === "japanese"
      ? territory.B + this.captures.B + deadCount.W
      : stones.B + territory.B;
    const white = (rule === "japanese"
      ? territory.W + this.captures.W + deadCount.B
      : stones.W + territory.W) + this.komi;
    return {
      black,
      white,
      winner: black === white ? "draw" : black > white ? "black" : "white",
      margin: Math.abs(black - white),
      neutral,
    };
  }
}
