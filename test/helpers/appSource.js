import { readdirSync, readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);

/**
 * The page's source files: src/main.js, then the modules split out of it in
 * src/app/ (alphabetical). Wiring tests look page functions up by name, so
 * they search all of them.
 */
export const APP_SOURCE_FILES = Object.freeze([
  "src/main.js",
  ...readdirSync(new URL("src/app/", root))
    .filter((name) => name.endsWith(".js"))
    .sort()
    .map((name) => `src/app/${name}`),
]);

/**
 * The page source as one text with LF line ends. Each file starts on a new
 * line, so a slice between two function names never runs across files
 * unless both are in the same one.
 */
export function appSource() {
  return APP_SOURCE_FILES
    .map((path) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/gu, "\n"))
    .join("\n");
}
