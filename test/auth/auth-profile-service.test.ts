import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import {
  AuthProfileService,
  resolveAuthProfilePaths,
} from "../../src/auth/auth-profile-service.js";

test("AuthProfileService persists profiles and resolves managed auth sources", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "auth-profile-service-"));
  const timestamps = [
    "2026-03-20T00:00:00.000Z",
    "2026-03-20T00:00:01.000Z",
    "2026-03-20T00:00:02.000Z",
    "2026-03-20T00:00:03.000Z",
  ];
  const service = new AuthProfileService({
    stateRoot,
    idGenerator: () => "profile-1",
    now: () => timestamps.shift() ?? "2026-03-20T00:00:59.000Z",
  });

  const created = await service.createProfile({
    name: "Primary Analyst",
    accountLabel: "svc-analyst@example.com",
  });

  const paths = resolveAuthProfilePaths({
    stateRoot,
    authProfileId: "profile-1",
  });

  assert.equal(created.id, "profile-1");
  assert.equal(created.name, "Primary Analyst");
  assert.equal(created.accountLabel, "svc-analyst@example.com");
  assert.equal(created.homePath, paths.homePath);
  assert.equal(created.codexHomePath, paths.codexHomePath);
  assert.equal(created.login.defaultMethod, "device-auth");
  assert.equal(created.login.status, "idle");

  const listed = await service.listProfiles();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.id, "profile-1");

  const resolvedAuthSource = await service.resolveRuntimeAuthSource("profile-1");
  assert.deepEqual(resolvedAuthSource, {
    kind: "managed-home",
    authProfileId: "profile-1",
    homePath: paths.homePath,
  });

  const updated = await service.updateProfile({
    id: "profile-1",
    name: "Primary Analyst Updated",
    accountLabel: null,
  });
  assert.equal(updated.name, "Primary Analyst Updated");
  assert.equal(updated.accountLabel, null);

  const markedUsed = await service.markProfileUsed("profile-1");
  assert.equal(markedUsed.lastUsedAt, "2026-03-20T00:00:03.000Z");

  await service.deleteProfile("profile-1");
  await assert.rejects(service.getProfile("profile-1"), /Unknown auth profile: profile-1/);
});
