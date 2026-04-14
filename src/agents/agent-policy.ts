import path from "node:path";

import type {
  AgentRuntimePolicy,
  AgentToolPolicy,
} from "./agent-types.js";

export const DEFAULT_AGENT_WORKSPACE_MODE = "directory";
export const DEFAULT_UV_VENV_DIRNAME = ".venv";

export function buildDefaultAgentRuntimePolicy(): AgentRuntimePolicy {
  return {
    workspaceMode: DEFAULT_AGENT_WORKSPACE_MODE,
    gitBackedWorkspace: false,
    isolatedHome: true,
    isolatedXdg: true,
  };
}

export function resolveUvPythonCandidates(venvPath: string): string[] {
  return [
    path.join(venvPath, "bin", "python"),
    path.join(venvPath, "Scripts", "python.exe"),
  ];
}

export function resolveUvPipCandidates(venvPath: string): string[] {
  return [
    path.join(venvPath, "bin", "pip"),
    path.join(venvPath, "bin", "pip3"),
    path.join(venvPath, "Scripts", "pip.exe"),
  ];
}

export function resolveUvVenvPath(
  workspaceRoot: string,
  venvPath?: string
): string {
  return path.resolve(
    venvPath ?? path.join(workspaceRoot, DEFAULT_UV_VENV_DIRNAME)
  );
}

export function buildDefaultAgentToolPolicy({
  workspaceRoot,
}: {
  workspaceRoot: string;
}): AgentToolPolicy {
  const venvPath = resolveUvVenvPath(workspaceRoot);

  return {
    python: {
      enabled: true,
      mode: "agent-local-uv-venv",
      venvPath,
      interpreterCandidates: resolveUvPythonCandidates(venvPath),
      systemFallback: "python3",
    },
    ssh: {
      enabled: true,
      mode: "system-installed",
      command: "ssh",
    },
  };
}

export function policiesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
