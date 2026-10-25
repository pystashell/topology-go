// npm run test:soak: the full soak plan (every board size of every game on
// every topology, at least ten random games each; small boards a hundred)
// against the independent references in test/helpers. The same files run a
// quick plan inside npm test.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const testDir = fileURLToPath(new URL("../test/", import.meta.url));
const files = readdirSync(testDir)
  .filter((name) => /^soak\..+\.test\.js$/u.test(name))
  .map((name) => `test/${name}`);
const result = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
  env: { ...process.env, SOAK: "full" },
  cwd: fileURLToPath(new URL("../", import.meta.url)),
});
process.exitCode = result.status ?? 1;
