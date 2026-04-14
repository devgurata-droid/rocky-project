import test from "node:test";
import assert from "node:assert/strict";

import {
  extractWorkspaceRelativeArtifactPath,
  inferWorkspacePathKind,
  resolveWorkspaceHrefTarget,
} from "../../web/src/shared/lib/workspace-link-target.js";

const WORKSPACE_ROOT = "/Users/korjsh/project/rocky-project/.runtime/agent-engine/agents/demo/workspace";

test("resolveWorkspaceHrefTarget routes workspace file references into workspace preview", () => {
  assert.deepEqual(
    resolveWorkspaceHrefTarget(
      `${WORKSPACE_ROOT}/docs/sample-plan.md#L42`,
      WORKSPACE_ROOT
    ),
    {
      kind: "workspace",
      path: "docs/sample-plan.md",
      pathKind: "file",
    }
  );

  assert.deepEqual(resolveWorkspaceHrefTarget("samples/demo.mp4", WORKSPACE_ROOT), {
    kind: "workspace",
    path: "samples/demo.mp4",
    pathKind: "file",
  });
});

test("resolveWorkspaceHrefTarget opens external URLs in a new tab and rejects out-of-workspace file paths", () => {
  assert.deepEqual(resolveWorkspaceHrefTarget("https://example.com/demo", WORKSPACE_ROOT), {
    kind: "external",
    href: "https://example.com/demo",
  });

  assert.deepEqual(
    resolveWorkspaceHrefTarget("/Users/korjsh/Desktop/outside.md", WORKSPACE_ROOT),
    {
      kind: "invalid",
    }
  );
});

test("resolveWorkspaceHrefTarget keeps file:// workspace links inside the current workspace", () => {
  assert.deepEqual(
    resolveWorkspaceHrefTarget(
      `file://${WORKSPACE_ROOT}/samples/sample-image.png`,
      WORKSPACE_ROOT
    ),
    {
      kind: "workspace",
      path: "samples/sample-image.png",
      pathKind: "file",
    }
  );
});

test("inferWorkspacePathKind leaves extensionless targets ambiguous", () => {
  assert.equal(inferWorkspacePathKind("docs/Makefile"), "ambiguous");
  assert.equal(inferWorkspacePathKind("docs/reports/"), "directory");
  assert.equal(inferWorkspacePathKind("docs/plan.md"), "file");
});

test("extractWorkspaceRelativeArtifactPath recovers the original workspace file path from captured artifacts", () => {
  const artifactsDir =
    "/Users/korjsh/project/rocky-project/.runtime/agent-engine/runs/run-123/artifacts";
  const artifactPath = `${artifactsDir}/workspace/samples/sample-markdown.md`;

  assert.equal(
    extractWorkspaceRelativeArtifactPath(artifactPath, artifactsDir),
    "samples/sample-markdown.md"
  );
  assert.equal(
    extractWorkspaceRelativeArtifactPath(`${artifactsDir}/charts/output.json`, artifactsDir),
    null
  );
});
