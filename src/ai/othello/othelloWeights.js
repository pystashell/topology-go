/**
 * Evaluation weights per topology: one row per phase knot (PHASE_KNOTS in
 * othelloEval.js: share of the board filled 0, 0.2, ..., 1), each row in
 * FEATURES order (mobility, potential, frontier, discs, row0, row1, row2,
 * stable, parity, scarcity).
 *
 * Fitted by ridge least squares (othelloTuning.js) to self-play positions on
 * 6x6, 8x8 and 10x10 boards, labelled with the perfect-play result once 12
 * empties remain. On the torus the fit is dominated by parity (whoever
 * moves last usually wins, and any pass, by either side, changes that).
 * Its disc and scarcity weights were then set by paired-seed matches (AI as
 * Black, the side that needs a pass, against random and greedy players):
 * keeping few discs and few moves of its own helps the first player get the
 * pass it needs.
 */
export const FITTED_WEIGHTS = Object.freeze({
  cylinder: Object.freeze([
    Object.freeze([8, -39, -7, -27, 9, -65, -25, 0, 60, 0]),
    Object.freeze([-5, 41, 51, 57, 192, -119, 20, 1, 61, 0]),
    Object.freeze([8, 33, 80, 54, 190, -103, -8, 168, 59, 0]),
    Object.freeze([115, 14, 76, 77, 136, -65, -6, 157, 55, 0]),
    Object.freeze([148, 16, 59, 27, 78, -13, -6, 100, 49, 0]),
    Object.freeze([17, 9, 22, -5, -6, -20, -12, -2, 14, 0]),
  ]),
  torus: Object.freeze([
    Object.freeze([11, -10, 8, -120, 0, 0, 0, 0, 176, -150]),
    Object.freeze([-25, 23, -1, -120, 0, 0, 0, 0, 182, -150]),
    Object.freeze([5, -1, 9, -120, 0, 0, 0, 0, 182, -150]),
    Object.freeze([10, 1, 24, -120, 0, 0, 0, 0, 179, -150]),
    Object.freeze([18, -7, 25, -120, 0, 0, 0, 5, 156, -150]),
    Object.freeze([5, 3, 8, -120, 0, 0, 0, 1, 19, -150]),
  ]),
  mobius: Object.freeze([
    Object.freeze([2, -14, -15, -13, 10, -47, -65, 0, 106, 0]),
    Object.freeze([-19, 43, 24, 2, 78, -88, 29, 0, 110, 0]),
    Object.freeze([29, 57, 57, 16, 83, -62, 8, 0, 112, 0]),
    Object.freeze([111, 11, 59, 42, 47, -73, -15, 5, 108, 0]),
    Object.freeze([165, -30, 94, -7, 41, -44, -15, 95, 88, 0]),
    Object.freeze([8, 0, 9, 1, -9, -23, 11, 10, 0, 0]),
  ]),
});
