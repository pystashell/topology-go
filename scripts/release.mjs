#!/usr/bin/env node

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ReleaseError,
  assertGithubReleaseIdentity,
  assertReleaseBranch,
  assertVersionManifest,
  assertWorkerVersionIdentity,
  createVersionManifest,
  findStableDeploymentForVersion,
  findWorkerVersionByTag,
  formatReleaseNotes,
  isWorkerVersionId,
  latestDeployment,
  normalizeReleaseVersion,
  expectedWorkerMessage,
  unwrapJsonList,
  workerVersionTag,
} from "./release-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_FILE = join(ROOT, "public", "version.json");
const WRANGLER_CONFIG = join(ROOT, "wrangler.jsonc");
const IS_WINDOWS = process.platform === "win32";
const WINDOWS_NPM_CLI = resolve(
  dirname(process.execPath),
  "node_modules",
  "npm",
  "bin",
  "npm-cli.js",
);
const npmCommand = IS_WINDOWS
  ? {
      program: process.execPath,
      prefix: [process.env.npm_execpath || WINDOWS_NPM_CLI],
    }
  : { program: "npm", prefix: [] };
const BIN = Object.freeze({
  git: { program: IS_WINDOWS ? "git.exe" : "git", prefix: [] },
  gh: { program: IS_WINDOWS ? "gh.exe" : "gh", prefix: [] },
  npm: npmCommand,
  wrangler: {
    program: process.execPath,
    prefix: [join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js")],
  },
});
const NETWORK_ENV = Object.freeze({
  NODE_USE_SYSTEM_CA: process.env.NODE_USE_SYSTEM_CA || "1",
});

function commandSpec(command, args) {
  const spec = typeof command === "string"
    ? { program: command, prefix: [] }
    : command;
  return { program: spec.program, args: [...(spec.prefix ?? []), ...args] };
}

function commandText(command, args) {
  const spec = commandSpec(command, args);
  return [spec.program, ...spec.args]
    .map((part) => /\s/u.test(part) ? JSON.stringify(part) : part)
    .join(" ");
}

function execute(command, args, { capture = false, allowFailure = false, env = {} } = {}) {
  const spec = commandSpec(command, args);
  if (command === BIN.npm && IS_WINDOWS && !existsSync(spec.args[0])) {
    throw new ReleaseError(`npm CLI was not found at '${spec.args[0]}'.`, "COMMAND_START_FAILED");
  }
  const result = spawnSync(spec.program, spec.args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    stdio: capture ? "pipe" : "inherit",
    env: { ...process.env, ...env },
  });
  if (result.error) {
    throw new ReleaseError(
      `Unable to start '${commandText(command, args)}': ${result.error.message}`,
      "COMMAND_START_FAILED",
    );
  }
  const status = Number.isInteger(result.status) ? result.status : 1;
  if (status !== 0 && !allowFailure) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new ReleaseError(
      `Command failed (${status}): ${commandText(command, args)}${detail ? `\n${detail}` : ""}`,
      "COMMAND_FAILED",
    );
  }
  return {
    status,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

function captured(program, args, options = {}) {
  return execute(program, args, { ...options, capture: true });
}

function parseJsonOutput(result, label) {
  try {
    return JSON.parse(result.stdout.replace(/^\uFEFF/u, ""));
  } catch (error) {
    throw new ReleaseError(
      `${label} did not return valid JSON: ${error.message}`,
      "INVALID_COMMAND_OUTPUT",
    );
  }
}

function readManifest() {
  try {
    return JSON.parse(readFileSync(VERSION_FILE, "utf8"));
  } catch (error) {
    throw new ReleaseError(
      `Unable to read public/version.json: ${error.message}`,
      "INVALID_MANIFEST",
    );
  }
}

function writeManifest(version) {
  const manifest = createVersionManifest(version);
  writeFileSync(VERSION_FILE, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

function requestedRelease(value) {
  const manifest = readManifest();
  return assertVersionManifest(manifest, value ?? manifest.version);
}

function currentBranch() {
  const actual = captured(BIN.git, ["branch", "--show-current"]).stdout.trim();
  const workflowBranch = String(process.env.RELEASE_SOURCE_BRANCH ?? "").trim();
  if (actual) {
    assertReleaseBranch(actual);
    if (workflowBranch) assertReleaseBranch(workflowBranch);
    return actual;
  }
  return assertReleaseBranch(workflowBranch);
}

function gitHead() {
  return captured(BIN.git, ["rev-parse", "HEAD"]).stdout.trim();
}

function nodeMajor() {
  return Number(process.versions.node.split(".")[0]);
}

function assertCleanWorktree() {
  const status = captured(BIN.git, ["status", "--porcelain"]).stdout.trim();
  if (status) {
    throw new ReleaseError(
      "Release publishing requires a clean worktree. Commit the reviewed release changes first.",
      "DIRTY_WORKTREE",
    );
  }
}

function localTagCommit(tag) {
  const result = captured(BIN.git, ["rev-list", "-n", "1", tag], { allowFailure: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

function assertLocalTagSafe(tag, head) {
  const taggedCommit = localTagCommit(tag);
  if (taggedCommit && taggedCommit !== head) {
    throw new ReleaseError(
      `Local tag '${tag}' already points to ${taggedCommit}, not HEAD ${head}.`,
      "TAG_CONFLICT",
    );
  }
  return taggedCommit;
}

function releaseContext(version, { requireClean = true } = {}) {
  if (nodeMajor() < 22) {
    throw new ReleaseError(`Node 22 or newer is required; found ${process.version}.`, "OLD_NODE");
  }
  const branch = currentBranch();
  const release = requestedRelease(version);
  const head = gitHead();
  if (requireClean) assertCleanWorktree();
  assertLocalTagSafe(release.tag, head);
  return { branch, release, head };
}

function workerName() {
  const source = readFileSync(WRANGLER_CONFIG, "utf8");
  const match = source.match(/"name"\s*:\s*"([^"]+)"/u);
  if (!match) throw new ReleaseError("wrangler.jsonc does not declare a Worker name.", "MISSING_WORKER_NAME");
  return match[1];
}

function releaseMessage(release, head) {
  return expectedWorkerMessage(release, head);
}

function runChecks(context) {
  const message = releaseMessage(context.release, context.head);
  execute(BIN.npm, ["test"]);
  execute(BIN.npm, ["run", "build"]);
  execute(
    BIN.npm,
    ["run", "deploy", "--", "--dry-run", "--strict", "--tag", context.release.tag, "--message", message],
    { env: NETWORK_ENV },
  );
}

function remoteTagCommit(tag) {
  const directRef = `refs/tags/${tag}`;
  const peeledRef = `${directRef}^{}`;
  const result = captured(
    BIN.git,
    ["ls-remote", "--tags", "origin", directRef, peeledRef],
    { env: NETWORK_ENV },
  );
  const refs = new Map(
    result.stdout.trim().split(/\r?\n/u).filter(Boolean).map((line) => {
      const [sha, ref] = line.trim().split(/\s+/u);
      return [ref, sha];
    }),
  );
  return refs.get(peeledRef) ?? refs.get(directRef) ?? null;
}

function ensurePublishedTag(context) {
  if (!localTagCommit(context.release.tag)) {
    execute(BIN.git, [
      "tag",
      "--annotate",
      context.release.tag,
      "--message",
      `3D Baduk ${context.release.tag}`,
      context.head,
    ]);
  }
  const remoteCommit = remoteTagCommit(context.release.tag);
  if (remoteCommit && remoteCommit !== context.head) {
    throw new ReleaseError(
      `Remote tag '${context.release.tag}' already points to ${remoteCommit}, not HEAD ${context.head}.`,
      "TAG_CONFLICT",
    );
  }
  if (!remoteCommit) {
    execute(BIN.git, ["push", "origin", `refs/tags/${context.release.tag}`], { env: NETWORK_ENV });
    const verified = remoteTagCommit(context.release.tag);
    if (verified !== context.head) {
      throw new ReleaseError(`Remote tag '${context.release.tag}' could not be verified.`, "TAG_PUSH_FAILED");
    }
  }
}

function cloudflareSnapshot() {
  const versions = unwrapJsonList(
    parseJsonOutput(
      captured(BIN.wrangler, ["versions", "list", "--json"], { env: NETWORK_ENV }),
      "wrangler versions list",
    ),
    "Wrangler versions",
  );
  const deployments = unwrapJsonList(
    parseJsonOutput(
      captured(BIN.wrangler, ["deployments", "list", "--json"], { env: NETWORK_ENV }),
      "wrangler deployments list",
    ),
    "Wrangler deployments",
  );
  return { versions, deployments };
}

function githubRelease(tag) {
  const result = captured(
    BIN.gh,
    ["release", "view", tag, "--json", "tagName,url,isPrerelease,body"],
    { allowFailure: true, env: NETWORK_ENV },
  );
  if (result.status === 0) return parseJsonOutput(result, "gh release view");
  const detail = `${result.stdout}\n${result.stderr}`;
  if (/release not found|HTTP 404|not found \(HTTP 404\)/iu.test(detail)) return null;
  throw new ReleaseError(`Unable to verify GitHub Release '${tag}': ${detail.trim()}`, "GITHUB_CHECK_FAILED");
}

function deployRelease(context) {
  const message = releaseMessage(context.release, context.head);
  let snapshot = cloudflareSnapshot();
  let version = findWorkerVersionByTag(snapshot.versions, context.release.tag);
  if (version) assertWorkerVersionIdentity(version, context.release, context.head);
  let deployment = version
    ? findStableDeploymentForVersion(snapshot.deployments, version.id)
    : null;

  if (!version) {
    execute(
      BIN.npm,
      ["run", "deploy", "--", "--strict", "--tag", context.release.tag, "--message", message],
      { env: NETWORK_ENV },
    );
  } else if (!deployment) {
    execute(
      BIN.wrangler,
      [
        "versions",
        "deploy",
        "--version-id",
        version.id,
        "--percentage",
        "100",
        "--message",
        message,
        "--yes",
      ],
      { env: NETWORK_ENV },
    );
  }

  snapshot = cloudflareSnapshot();
  version = findWorkerVersionByTag(snapshot.versions, context.release.tag);
  if (!version?.id) {
    throw new ReleaseError(
      `Cloudflare did not report a Worker Version tagged '${context.release.tag}'.`,
      "DEPLOYMENT_NOT_VERIFIED",
    );
  }
  assertWorkerVersionIdentity(version, context.release, context.head);
  deployment = findStableDeploymentForVersion(snapshot.deployments, version.id);
  if (!deployment?.id) {
    throw new ReleaseError(
      `Cloudflare did not report a 100% deployment for Worker Version '${version.id}'.`,
      "DEPLOYMENT_NOT_VERIFIED",
    );
  }
  return { version, deployment };
}

function createGithubRelease(context, cloudflare) {
  const existing = githubRelease(context.release.tag);
  if (existing) {
    return assertGithubReleaseIdentity(existing, {
      release: context.release,
      gitSha: context.head,
      workerVersionId: cloudflare.version.id,
      deploymentId: cloudflare.deployment.id,
    });
  }

  const notes = formatReleaseNotes({
    release: context.release,
    gitSha: context.head,
    branch: context.branch,
    workerName: workerName(),
    workerVersionId: cloudflare.version.id,
    deploymentId: cloudflare.deployment.id,
  });
  const directory = mkdtempSync(join(tmpdir(), "3d-baduk-release-"));
  const notesPath = join(directory, "notes.md");
  try {
    writeFileSync(notesPath, notes, "utf8");
    const args = [
      "release",
      "create",
      context.release.tag,
      "--verify-tag",
      "--target",
      context.head,
      "--title",
      `3D Baduk ${context.release.tag}`,
      "--notes-file",
      notesPath,
      "--generate-notes",
    ];
    if (context.release.prerelease) args.push("--prerelease");
    execute(BIN.gh, args, { env: NETWORK_ENV });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  const created = githubRelease(context.release.tag);
  if (!created) {
    throw new ReleaseError("GitHub Release creation could not be verified.", "GITHUB_RELEASE_NOT_VERIFIED");
  }
  return assertGithubReleaseIdentity(created, {
    release: context.release,
    gitSha: context.head,
    workerVersionId: cloudflare.version.id,
    deploymentId: cloudflare.deployment.id,
  });
}

function printReleaseRecord(context, cloudflare, github) {
  console.log(JSON.stringify({
    version: context.release.version,
    tag: context.release.tag,
    prerelease: context.release.prerelease,
    git: { branch: context.branch, commit: context.head },
    cloudflare: {
      worker: workerName(),
      versionId: cloudflare.version.id,
      deploymentId: cloudflare.deployment.id,
    },
    github: { url: github.url, tagName: github.tagName },
  }, null, 2));
}

function listReleases({ json = false } = {}) {
  const github = unwrapJsonList(
    parseJsonOutput(
      captured(BIN.gh, [
        "release",
        "list",
        "--limit",
        "30",
        "--json",
        "tagName,name,isPrerelease,isDraft,publishedAt",
      ], { env: NETWORK_ENV }),
      "gh release list",
    ),
    "GitHub releases",
  );
  const cloudflare = cloudflareSnapshot();
  if (json) {
    console.log(JSON.stringify({ github, cloudflare }, null, 2));
    return;
  }

  console.log("GitHub Releases");
  for (const release of github) {
    const flags = [release.isPrerelease ? "prerelease" : "stable", release.isDraft ? "draft" : null]
      .filter(Boolean).join(", ");
    console.log(`  ${release.tagName}  ${flags}  ${release.publishedAt ?? "unpublished"}`);
  }
  console.log("\nCloudflare Worker Versions");
  for (const version of cloudflare.versions) {
    console.log(
      `  ${workerVersionTag(version) ?? "(untagged)"}  ${version.id}  ${version.metadata?.created_on ?? ""}`,
    );
  }
  console.log("\nCloudflare Deployments");
  for (const deployment of cloudflare.deployments) {
    const traffic = (deployment.versions ?? [])
      .map((item) => `${item.version_id}@${item.percentage}%`)
      .join(", ");
    console.log(`  ${deployment.id}  ${deployment.created_on ?? ""}  ${traffic}`);
  }
}

function rollbackRelease(target, { confirmed = false } = {}) {
  if (!confirmed) {
    throw new ReleaseError(
      "Rollback changes production traffic. Re-run with '--yes' after checking release:list.",
      "CONFIRMATION_REQUIRED",
    );
  }
  if (!target) throw new ReleaseError("A SemVer tag or Worker Version ID is required.", "MISSING_TARGET");

  const before = cloudflareSnapshot();
  let versionId = String(target).trim();
  let label = versionId;
  if (!isWorkerVersionId(versionId)) {
    const release = normalizeReleaseVersion(versionId);
    const version = findWorkerVersionByTag(before.versions, release.tag);
    if (!version?.id) {
      throw new ReleaseError(
        `No recent Cloudflare Worker Version is tagged '${release.tag}'. Use its immutable Version ID instead.`,
        "WORKER_VERSION_NOT_FOUND",
      );
    }
    versionId = version.id;
    label = release.tag;
  }

  const current = latestDeployment(before.deployments);
  const alreadyStable = current?.versions?.some(
    (traffic) => traffic?.version_id === versionId && Number(traffic?.percentage) === 100,
  );
  if (!alreadyStable) {
    execute(
      BIN.wrangler,
      ["rollback", versionId, "--message", `Rollback to ${label}`, "--yes"],
      { env: NETWORK_ENV },
    );
  }

  const after = cloudflareSnapshot();
  const deployment = latestDeployment(after.deployments);
  const verified = deployment?.versions?.some(
    (traffic) => traffic?.version_id === versionId && Number(traffic?.percentage) === 100,
  );
  if (!verified || !deployment?.id) {
    throw new ReleaseError(
      `Rollback to Worker Version '${versionId}' could not be verified.`,
      "ROLLBACK_NOT_VERIFIED",
    );
  }
  console.log(JSON.stringify({
    rollbackTarget: label,
    workerVersionId: versionId,
    deploymentId: deployment.id,
    alreadyStable,
  }, null, 2));
}

function printPlan(context) {
  const npmVersion = captured(BIN.npm, ["--version"]).stdout.trim();
  const wranglerVersion = captured(BIN.wrangler, ["--version"]).stdout.trim();
  const ghVersion = captured(BIN.gh, ["--version"]).stdout.trim().split(/\r?\n/u)[0];
  console.log([
    `Release plan for ${context.release.tag}`,
    `  source branch: ${context.branch}`,
    `  current commit: ${context.head}`,
    `  channel: ${context.release.channel}`,
    `  toolchain: Node ${process.versions.node}, npm ${npmVersion}, Wrangler ${wranglerVersion}, ${ghVersion}`,
    "  1. npm test",
    "  2. npm run build",
    "  3. npm run deploy -- --dry-run --strict (preflight only)",
    `  4. create and push annotated tag ${context.release.tag}`,
    "  5. npm run deploy -- --strict --tag <tag> --message <tag+sha>",
    "  6. verify Cloudflare Worker Version ID and Deployment ID via Wrangler JSON",
    "  7. create a verified-tag GitHub Release containing both Cloudflare IDs",
    "No tag, push, deployment, or GitHub Release was created by this plan command.",
  ].join("\n"));
}

function usage() {
  console.log(`Usage:
  node scripts/release.mjs version <semver>
  node scripts/release.mjs plan [semver]
  node scripts/release.mjs check [semver]
  node scripts/release.mjs publish [semver]
  node scripts/release.mjs list [--json]
  node scripts/release.mjs rollback <semver|version-id> --yes`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const flags = new Set(args.filter((arg) => arg.startsWith("--")));
  const positional = args.filter((arg) => !arg.startsWith("--"));

  if (command === "version") {
    const branch = currentBranch();
    const manifest = writeManifest(positional[0]);
    console.log(`Prepared ${manifest.tag} on '${branch}' in public/version.json.`);
    return;
  }
  if (command === "plan") {
    printPlan(releaseContext(positional[0], { requireClean: false }));
    return;
  }
  if (command === "check") {
    const context = releaseContext(positional[0]);
    runChecks(context);
    console.log(`Release preflight passed for ${context.release.tag} on '${context.branch}'.`);
    return;
  }
  if (command === "publish") {
    const context = releaseContext(positional[0]);
    runChecks(context);
    ensurePublishedTag(context);
    const existing = githubRelease(context.release.tag);
    if (existing) {
      const snapshot = cloudflareSnapshot();
      const version = findWorkerVersionByTag(snapshot.versions, context.release.tag);
      if (version) assertWorkerVersionIdentity(version, context.release, context.head);
      const deployment = version
        ? findStableDeploymentForVersion(snapshot.deployments, version.id)
        : null;
      if (!version || !deployment) {
        throw new ReleaseError(
          `GitHub Release '${context.release.tag}' exists, but its stable Cloudflare deployment is missing.`,
          "INCONSISTENT_RELEASE",
        );
      }
      assertGithubReleaseIdentity(existing, {
        release: context.release,
        gitSha: context.head,
        workerVersionId: version.id,
        deploymentId: deployment.id,
      });
      printReleaseRecord(context, { version, deployment }, existing);
      return;
    }
    const cloudflare = deployRelease(context);
    const github = createGithubRelease(context, cloudflare);
    printReleaseRecord(context, cloudflare, github);
    return;
  }
  if (command === "list") {
    listReleases({ json: flags.has("--json") });
    return;
  }
  if (command === "rollback") {
    rollbackRelease(positional[0], { confirmed: flags.has("--yes") });
    return;
  }

  usage();
  if (command) throw new ReleaseError(`Unknown command '${command}'.`, "UNKNOWN_COMMAND");
}

main().catch((error) => {
  const code = error instanceof ReleaseError ? error.code : "UNEXPECTED_ERROR";
  console.error(`[${code}] ${error.message}`);
  process.exitCode = 1;
});
