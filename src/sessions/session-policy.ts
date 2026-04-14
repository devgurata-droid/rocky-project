import path from "node:path";

import type { AgentRecord } from "../agents/agent-types.js";
import type {
  AgentSessionCreateInput,
  AgentSessionRecord,
  AgentSessionTurnInput,
} from "./session-types.js";

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function ensureFixedPath(
  label: "workspaceRoot" | "runtimeHome",
  candidatePath: string | undefined,
  expectedPath: string
): void {
  if (!candidatePath) {
    return;
  }

  const resolvedCandidate = path.resolve(candidatePath);
  const resolvedExpected = path.resolve(expectedPath);
  if (resolvedCandidate !== resolvedExpected) {
    throw new SessionPolicyError(
      `${label} must stay fixed to the agent ${label}: ${resolvedExpected}`
    );
  }
}

function ensureAllowedWritableDirs(
  writableDirs: string[] | undefined,
  allowedRoots: string[]
): void {
  for (const writableDir of writableDirs ?? []) {
    const resolvedDir = path.resolve(writableDir);
    if (!allowedRoots.some((rootPath) => isWithinRoot(resolvedDir, rootPath))) {
      throw new SessionPolicyError(
        `additionalWritableDirs entry is outside allowed roots: ${resolvedDir}`
      );
    }
  }
}

function ensureManagedSandboxBypassDisabled(
  dangerouslyBypassApprovalsAndSandbox: boolean | undefined
): void {
  if (dangerouslyBypassApprovalsAndSandbox) {
    throw new SessionPolicyError(
      "dangerouslyBypassApprovalsAndSandbox is not allowed for managed agent sessions"
    );
  }
}

export class SessionPolicyError extends Error {
  readonly statusCode = 403;

  constructor(message: string) {
    super(message);
    this.name = "SessionPolicyError";
  }
}

export function validateSessionCreateInput(
  agent: AgentRecord,
  input: AgentSessionCreateInput
): void {
  ensureFixedPath("workspaceRoot", input.workspaceRoot, agent.workspaceRoot);
  ensureFixedPath("runtimeHome", input.runtimeHome, agent.runtimeHome);
  ensureManagedSandboxBypassDisabled(
    input.dangerouslyBypassApprovalsAndSandbox
  );
  ensureAllowedWritableDirs(input.additionalWritableDirs, [
    path.resolve(agent.workspaceRoot),
    path.resolve(agent.runtimeHome),
  ]);
}

export function validatePersistedSessionRoots(
  agent: AgentRecord,
  session: AgentSessionRecord
): void {
  ensureFixedPath("workspaceRoot", session.workspaceRoot, agent.workspaceRoot);
  ensureFixedPath("runtimeHome", session.runtimeHome, agent.runtimeHome);
}

export function validateSessionTurnInput(
  session: AgentSessionRecord,
  input: AgentSessionTurnInput
): void {
  ensureFixedPath("workspaceRoot", input.workspaceRoot, session.workspaceRoot);
  ensureFixedPath("runtimeHome", input.runtimeHome, session.runtimeHome);
  ensureManagedSandboxBypassDisabled(
    input.dangerouslyBypassApprovalsAndSandbox
  );
  ensureAllowedWritableDirs(input.additionalWritableDirs, [
    path.resolve(session.workspaceRoot),
    path.resolve(session.runtimeHome),
  ]);
}
