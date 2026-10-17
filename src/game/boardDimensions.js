/**
 * Dimensions accepted by the rules engine and every persisted wire format.
 * The public new-game UI has a stricter minimum of 5, while the lower minimum
 * remains available for backwards-compatible SGF and saved-state imports.
 */
export const MIN_BOARD_DIMENSION = 3;
export const PUBLIC_MIN_BOARD_DIMENSION = 5;
export const MAX_BOARD_DIMENSION = 30;

const GO_COLUMN_DIGITS = "ABCDEFGHJKLMNOPQRSTUVWXYZ";

/**
 * Format an extended Go column label. Standard boards retain A..Z (skipping
 * I); wider boards continue spreadsheet-style with AA, AB, ... while using
 * the same 25-letter alphabet.
 */
export function formatGoColumn(col) {
  if (!Number.isSafeInteger(col) || col < 0) return "";
  const radix = GO_COLUMN_DIGITS.length;
  let value = col + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = GO_COLUMN_DIGITS[value % radix] + label;
    value = Math.floor(value / radix);
  }
  return label;
}

/** Return the zero-based column represented by an extended Go label. */
export function parseGoColumn(value) {
  const label = String(value ?? "").trim().toUpperCase();
  if (!label || !/^[A-HJ-Z]+$/u.test(label)) return -1;
  const radix = GO_COLUMN_DIGITS.length;
  let result = 0;
  for (const character of label) {
    const digit = GO_COLUMN_DIGITS.indexOf(character);
    if (digit < 0) return -1;
    result = result * radix + digit + 1;
    if (!Number.isSafeInteger(result)) return -1;
  }
  return result - 1;
}

/**
 * Backwards-compatible indexed export used by the UI. This is an array rather
 * than a string because columns after Z have two-character labels.
 */
export const GO_COLUMN_LABELS = Object.freeze(
  Array.from({ length: MAX_BOARD_DIMENSION }, (_, col) => formatGoColumn(col)),
);
