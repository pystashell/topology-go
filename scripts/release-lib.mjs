const CORE_NUMBER = "(?:0|[1-9]\\d*)";
const PRERELEASE_IDENTIFIER = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";
const BUILD_IDENTIFIER = "[0-9A-Za-z-]+";
const SEMVER_PATTERN = new RegExp(
  `^(${CORE_NUMBER})\\.(${CORE_NUMBER})\\.(${CORE_NUMBER})` +
    `(?:-(${PRERELEASE_IDENTIFIER}(?:\\.${PRERELEASE_IDENTIFIER})*))?` +
    `(?:\\+(${BUILD_IDENTIFIER}(?:\\.${BUILD_IDENTIFIER})*))?$`,
  "u",
);

export class ReleaseError extends Error {
  constructor(message, code = "RELEASE_ERROR") {
    super(message);
    this.name = "ReleaseError";
    this.code = code;
  }
}

export function normalizeReleaseVersion(input) {
  const supplied = String(input ?? "").trim();
  const version = supplied.startsWith("v") ? supplied.slice(1) : supplied;
  const match = version.match(SEMVER_PATTERN);
  if (!match) {
    throw new ReleaseError(
      `Invalid release version '${supplied || "(empty)"}'. Use SemVer such as 0.2.0 or 0.2.0-rc.1.`,
      "INVALID_VERSION",
    );
  }
  return Object.freeze({
    version,
    tag: `v${version}`,
    prerelease: Boolean(match[4]),
    channel: match[4] ? "prerelease" : "stable",
  });
}

export function createVersionManifest(input) {
  const release = normalizeReleaseVersion(input);
  return {
    version: release.version,
    tag: release.tag,
    channel: release.channel,
  };
}

export function assertVersionManifest(manifest, requestedVersion) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new ReleaseError("public/version.json must contain a JSON object.", "INVALID_MANIFEST");
  }
  const requested = normalizeReleaseVersion(requestedVersion ?? manifest.version);
  const actual = normalizeReleaseVersion(manifest.version);
  if (actual.version !== requested.version) {
    throw new ReleaseError(
      `Requested ${requested.tag}, but public/version.json contains ${actual.tag}. Run release:version first.`,
      "VERSION_MISMATCH",
    );
  }
  if (manifest.tag !== actual.tag || manifest.channel !== actual.channel) {
    throw new ReleaseError(
      `public/version.json is inconsistent; expected tag '${actual.tag}' and channel '${actual.channel}'.`,
      "INVALID_MANIFEST",
    );
  }
  return requested;
}

export function normalizeBranchName(input) {
  return String(input ?? "")
    .trim()
    .replace(/^refs\/heads\//u, "");
}

export function assertReleaseBranch(input) {
  const branch = normalizeBranchName(input);
  if (!branch || branch === "HEAD") {
    throw new ReleaseError(
      "Release publishing requires a named feature/release branch; detached HEAD is not allowed.",
      "DETACHED_HEAD",
    );
  }
  if (["main", "master"].includes(branch.toLowerCase())) {
    throw new ReleaseError(
      `Direct releases from '${branch}' are forbidden. Publish from a reviewed feature/release branch.`,
      "PROTECTED_BRANCH",
    );
  }
  return branch;
}

export function unwrapJsonList(value, label = "command output") {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray(value.result)) return value.result;
  throw new ReleaseError(`${label} was not a JSON array.`, "INVALID_COMMAND_OUTPUT");
}

export function workerVersionTag(version) {
  return version?.annotations?.["workers/tag"] ?? null;
}

export function expectedWorkerMessage(releaseInput, gitSha) {
  const release = normalizeReleaseVersion(releaseInput?.version ?? releaseInput);
  const commit = String(gitSha ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{40,64}$/u.test(commit)) {
    throw new ReleaseError("A full hexadecimal Git commit ID is required.", "INVALID_GIT_COMMIT");
  }
  return `${release.tag} (${commit})`;
}

export function assertWorkerVersionIdentity(version, releaseInput, gitSha) {
  const release = normalizeReleaseVersion(releaseInput?.version ?? releaseInput);
  const expectedMessage = expectedWorkerMessage(release, gitSha);
  const actualTag = workerVersionTag(version);
  const actualMessage = version?.annotations?.["workers/message"] ?? null;
  if (actualTag !== release.tag || actualMessage !== expectedMessage) {
    throw new ReleaseError(
      `Cloudflare Worker Version '${version?.id ?? "(unknown)"}' does not match Git commit ${gitSha}.`,
      "WORKER_VERSION_IDENTITY_MISMATCH",
    );
  }
  return version;
}

export function assertGithubReleaseIdentity(value, {
  release: releaseInput,
  gitSha,
  workerVersionId,
  deploymentId,
}) {
  const release = normalizeReleaseVersion(releaseInput?.version ?? releaseInput);
  const body = String(value?.body ?? "");
  const requiredBodyValues = [gitSha, workerVersionId, deploymentId].map((item) => String(item ?? ""));
  if (
    value?.tagName !== release.tag ||
    Boolean(value?.isPrerelease) !== release.prerelease ||
    requiredBodyValues.some((item) => !item || !body.includes(item))
  ) {
    throw new ReleaseError(
      `GitHub Release '${release.tag}' does not contain the expected commit and Cloudflare identifiers.`,
      "GITHUB_RELEASE_IDENTITY_MISMATCH",
    );
  }
  return value;
}

function createdTime(value) {
  const raw = value?.metadata?.created_on ?? value?.created_on ?? "";
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function findWorkerVersionByTag(versions, requestedTag) {
  const tag = normalizeReleaseVersion(requestedTag).tag;
  const matches = unwrapJsonList(versions, "Wrangler versions").filter(
    (version) => workerVersionTag(version) === tag,
  );
  if (matches.length > 1) {
    throw new ReleaseError(
      `Cloudflare has multiple recent Worker Versions tagged '${tag}'. Use an explicit Version ID.`,
      "AMBIGUOUS_WORKER_VERSION",
    );
  }
  return matches[0] ?? null;
}

export function findStableDeploymentForVersion(deployments, versionId) {
  const current = latestDeployment(deployments);
  if (!Array.isArray(current?.versions)) return null;
  return current.versions.some(
    (traffic) => traffic?.version_id === versionId && Number(traffic?.percentage) === 100,
  ) ? current : null;
}

export function latestDeployment(deployments) {
  return [...unwrapJsonList(deployments, "Wrangler deployments")]
    .sort((left, right) => createdTime(right) - createdTime(left))[0] ?? null;
}

export function formatReleaseNotes({
  release,
  gitSha,
  branch,
  workerName,
  workerVersionId,
  deploymentId,
}) {
  return [
    "## Deployment identity",
    "",
    `- App version: \`${release.version}\``,
    `- Git tag: \`${release.tag}\``,
    `- Git commit: \`${gitSha}\``,
    `- Source branch: \`${branch}\``,
    `- Cloudflare Worker: \`${workerName}\``,
    `- Cloudflare Worker Version ID: \`${workerVersionId}\``,
    `- Cloudflare Deployment ID: \`${deploymentId}\``,
    "",
    "The Worker Version ID is the immutable rollback target. The Deployment ID records the production traffic change.",
    "",
  ].join("\n");
}

export function isWorkerVersionId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
    String(value ?? "").trim(),
  );
}
