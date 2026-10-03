import assert from "node:assert/strict";
import test from "node:test";
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
  normalizeReleaseVersion,
} from "./release-lib.mjs";

test("normalizes stable and prerelease SemVer into immutable tags", () => {
  assert.deepEqual(normalizeReleaseVersion("v0.2.0-rc.1"), {
    version: "0.2.0-rc.1",
    tag: "v0.2.0-rc.1",
    prerelease: true,
    channel: "prerelease",
  });
  assert.deepEqual(normalizeReleaseVersion("1.4.0"), {
    version: "1.4.0",
    tag: "v1.4.0",
    prerelease: false,
    channel: "stable",
  });
  for (const invalid of [
    "",
    "1",
    "1.2",
    "01.2.3",
    "1.2.3-01",
    "latest",
    "0.2.0-rc.1$(whoami)",
    "0.2.0; echo unsafe",
  ]) {
    assert.throws(() => normalizeReleaseVersion(invalid), ReleaseError);
  }
});

test("version manifest has one internally consistent release identity", () => {
  const manifest = createVersionManifest("0.2.0-rc.1");
  assert.deepEqual(manifest, {
    version: "0.2.0-rc.1",
    tag: "v0.2.0-rc.1",
    channel: "prerelease",
  });
  assert.equal(assertVersionManifest(manifest, "v0.2.0-rc.1").tag, "v0.2.0-rc.1");
  assert.throws(
    () => assertVersionManifest(manifest, "0.2.0"),
    (error) => error.code === "VERSION_MISMATCH",
  );
  assert.throws(
    () => assertVersionManifest({ ...manifest, channel: "stable" }),
    (error) => error.code === "INVALID_MANIFEST",
  );
});

test("release branch guard rejects default branches and detached HEAD", () => {
  assert.equal(assertReleaseBranch("codex/release-candidate"), "codex/release-candidate");
  assert.equal(assertReleaseBranch("refs/heads/release/v0.2"), "release/v0.2");
  for (const protectedBranch of ["main", "MAIN", "master", "", "HEAD"]) {
    assert.throws(() => assertReleaseBranch(protectedBranch), ReleaseError);
  }
});

test("Cloudflare tag lookup is exact and refuses ambiguity", () => {
  const gitSha = "a".repeat(40);
  const versions = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      annotations: {
        "workers/tag": "v0.2.0-rc.1",
        "workers/message": `v0.2.0-rc.1 (${gitSha})`,
      },
      metadata: { created_on: "2026-07-19T01:00:00Z" },
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      annotations: { "workers/tag": "v0.1.0" },
      metadata: { created_on: "2026-07-18T01:00:00Z" },
    },
  ];
  assert.equal(findWorkerVersionByTag(versions, "0.2.0-rc.1").id, versions[0].id);
  assert.equal(
    assertWorkerVersionIdentity(versions[0], "0.2.0-rc.1", gitSha).id,
    versions[0].id,
  );
  assert.throws(
    () => assertWorkerVersionIdentity(versions[0], "0.2.0-rc.1", "b".repeat(40)),
    (error) => error.code === "WORKER_VERSION_IDENTITY_MISMATCH",
  );
  assert.equal(findWorkerVersionByTag(versions, "0.3.0"), null);
  assert.throws(
    () => findWorkerVersionByTag([...versions, { ...versions[0], id: "duplicate" }], "0.2.0-rc.1"),
    (error) => error.code === "AMBIGUOUS_WORKER_VERSION",
  );
});

test("stable deployment lookup only accepts the current 100 percent deployment", () => {
  const versionId = "11111111-1111-4111-8111-111111111111";
  const deployments = [
    {
      id: "old",
      created_on: "2026-07-18T01:00:00Z",
      versions: [{ version_id: versionId, percentage: 100 }],
    },
    {
      id: "split",
      created_on: "2026-07-20T01:00:00Z",
      versions: [{ version_id: versionId, percentage: 50 }],
    },
    {
      id: "new",
      created_on: "2026-07-19T01:00:00Z",
      versions: [{ version_id: versionId, percentage: 100 }],
    },
  ];
  assert.equal(findStableDeploymentForVersion(deployments, versionId), null);
  assert.equal(
    findStableDeploymentForVersion(
      deployments.filter((deployment) => deployment.id !== "split"),
      versionId,
    ).id,
    "new",
  );
});

test("release notes record every cross-system identifier", () => {
  const release = normalizeReleaseVersion("0.2.0-rc.1");
  const notes = formatReleaseNotes({
    release,
    gitSha: "abc123",
    branch: "codex/release-candidate",
    workerName: "bamboo-baduk",
    workerVersionId: "11111111-1111-4111-8111-111111111111",
    deploymentId: "22222222-2222-4222-8222-222222222222",
  });
  for (const expected of [
    "v0.2.0-rc.1",
    "abc123",
    "bamboo-baduk",
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ]) {
    assert.match(notes, new RegExp(expected.replaceAll(".", "\\."), "u"));
  }
  assert.equal(isWorkerVersionId("11111111-1111-4111-8111-111111111111"), true);
  assert.equal(isWorkerVersionId("v0.2.0"), false);

  const github = {
    tagName: release.tag,
    isPrerelease: true,
    body: notes,
  };
  assert.equal(assertGithubReleaseIdentity(github, {
    release,
    gitSha: "abc123",
    workerVersionId: "11111111-1111-4111-8111-111111111111",
    deploymentId: "22222222-2222-4222-8222-222222222222",
  }), github);
  assert.throws(
    () => assertGithubReleaseIdentity({ ...github, body: "missing deployment ids" }, {
      release,
      gitSha: "abc123",
      workerVersionId: "11111111-1111-4111-8111-111111111111",
      deploymentId: "22222222-2222-4222-8222-222222222222",
    }),
    (error) => error.code === "GITHUB_RELEASE_IDENTITY_MISMATCH",
  );
});
