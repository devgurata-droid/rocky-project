import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";

import {
  buildWorkspaceAgentsOverlay,
  isReservedSystemSkillName,
  listWorkspaceLocalSkills,
} from "../../src/agents/agent-workspace.js";

test("reserved system skill names are rejected from the workspace-local inventory", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "agent-workspace-skills-")
  );
  const skillRoot = path.join(workspaceRoot, "skills");

  await mkdir(path.join(skillRoot, "local-helper"), { recursive: true });
  await mkdir(path.join(skillRoot, ".system"), { recursive: true });
  await mkdir(path.join(skillRoot, "system-reporter"), { recursive: true });
  await writeFile(
    path.join(skillRoot, "local-helper", "SKILL.md"),
    "# Local Helper\n"
  );
  await writeFile(path.join(skillRoot, ".system", "SKILL.md"), "# System\n");
  await writeFile(
    path.join(skillRoot, "system-reporter", "SKILL.md"),
    "# System Reporter\n"
  );

  const skills = await listWorkspaceLocalSkills(workspaceRoot);
  const overlay = buildWorkspaceAgentsOverlay(workspaceRoot, skills);

  assert.deepEqual(skills.map((skill) => skill.name), ["local-helper"]);
  assert.match(overlay, /- local-helper: Agent-local workspace skill\./);
  assert.match(overlay, /\*\*System \(read-only\)\*\*/);
  assert.match(overlay, /openai-docs: OpenAI 제품\/API 관련 최신 공식 문서 기반 안내/);
  assert.match(overlay, /Repository-root developer skills are unavailable in agent sessions/);
  assert.doesNotMatch(overlay, /- system-reporter: Agent-local workspace skill\./);
  assert.doesNotMatch(overlay, /- \.system: Agent-local workspace skill\./);
});

test("isReservedSystemSkillName matches reserved namespaces only", () => {
  assert.equal(isReservedSystemSkillName(".system"), true);
  assert.equal(isReservedSystemSkillName("system"), true);
  assert.equal(isReservedSystemSkillName("system-reporter"), true);
  assert.equal(isReservedSystemSkillName("openai-docs"), true);
  assert.equal(isReservedSystemSkillName("skill-creator"), true);
  assert.equal(isReservedSystemSkillName("skill-installer"), true);
  assert.equal(isReservedSystemSkillName("local-helper"), false);
});
