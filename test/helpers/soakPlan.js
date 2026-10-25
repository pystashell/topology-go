/**
 * How many random games the soak tests play. \`npm test\` runs the quick plan
 * on every change: the smallest boards a hundred games each, plus a few
 * common sizes. \`npm run test:soak\` (SOAK=full) runs the full plan: every
 * board size the game allows on every topology at least ten games, a set of
 * rectangles, and the small boards a hundred games each.
 */

export const SOAK_FULL = process.env.SOAK === "full";

export function range(from, to, step = 1) {
  const values = [];
  for (let value = from; value <= to; value += step) values.push(value);
  return values;
}

export function squares(values) {
  return values.map((size) => [size, size]);
}

/** Run each [width, height, games, options] entry of a plan. */
export function runPlan(plan, play) {
  for (const [width, height, games, options = {}] of plan) {
    for (let game = 0; game < games; game += 1) play({ width, height, game, ...options });
  }
}
