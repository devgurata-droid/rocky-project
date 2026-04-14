import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import { AgentRegistryService } from "../../src/agents/agent-registry-service.js";

test("AgentRegistryService exposes backend-friendly agent registry operations", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-registry-service-"));
  const service = new AgentRegistryService({
    stateRoot,
    idGenerator: () => "service-agent",
    now: (() => {
      const timestamps = [
        "2026-03-13T00:00:00.000Z",
        "2026-03-13T00:10:00.000Z",
      ];
      return () => timestamps.shift() ?? "";
    })(),
  });

  const created = await service.createAgent({
    name: "service-managed-agent",
  });
  const updated = await service.updateAgent("service-agent", {
    approvalPolicy: "never",
  });
  const listed = await service.listAgents();
  const loaded = await service.getAgent("service-agent");

  assert.equal(created.id, "service-agent");
  assert.equal(updated.approvalPolicy, "never");
  assert.equal(listed.length, 1);
  assert.equal(loaded.name, "service-managed-agent");
  assert.equal(loaded.toolPolicy.ssh.command, "ssh");
});
