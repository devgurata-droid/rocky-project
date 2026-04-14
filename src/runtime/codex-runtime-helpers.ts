import path from "node:path";
import readline from "node:readline";

import { AsyncEventQueue } from "./async-event-queue.js";

import type {
  CodexCommandMode,
  RuntimeChildProcess,
  RuntimeEvent,
  RuntimeRunStart,
  RuntimeRunState,
  RuntimeSession,
  RuntimeSessionInput,
  RuntimeWorkspaceFileSnapshotEntry,
} from "./runtime-types.js";
import { normalizeRuntimeServiceTier } from "./runtime-types.js";

export type LiveRuntimeRunState = RuntimeRunState & {
  eventQueue: AsyncEventQueue<RuntimeEvent>;
};

export function attachLineReader(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void
): readline.Interface {
  const reader = readline.createInterface({ input: stream });
  reader.on("line", onLine);
  return reader;
}

export function buildRuntimeSession(
  input: RuntimeSessionInput,
  now: () => string,
  idGenerator: () => string,
  options: {
    kind?: RuntimeSession["runtimeKind"];
    defaultRuntimeHomeDirname?: string;
    defaultBin?: string;
  } = {}
): RuntimeSession {
  const runtimeKind = input.runtimeKind ?? options.kind ?? "codex-cli";
  const runtimeHomeDirname =
    options.defaultRuntimeHomeDirname ??
    (runtimeKind === "claude-code"
      ? "claude"
      : runtimeKind === "ollama"
        ? "ollama"
        : "codex");
  const defaultBin =
    options.defaultBin ??
    (runtimeKind === "claude-code"
      ? "claude"
      : runtimeKind === "ollama"
        ? "ollama"
        : "codex");

  return {
    id: input.id ?? idGenerator(),
    agentId: input.agentId ?? null,
    runtimeKind,
    runtimeSessionId: input.runtimeSessionId ?? null,
    workspaceRoot: path.resolve(input.workspaceRoot),
    runtimeHome: path.resolve(
      input.runtimeHome ??
        path.join(input.workspaceRoot, ".runtime", runtimeHomeDirname)
    ),
    config: {
      codexBin: input.codexBin ?? defaultBin,
      sandbox: input.sandbox ?? "read-only",
      approval: input.approval ?? null,
      profile: input.profile ?? null,
      authProfileId: input.authProfileId ?? null,
      model: input.model ?? null,
      reasoningEffort: input.reasoningEffort ?? null,
      serviceTier: normalizeRuntimeServiceTier(input.serviceTier),
      ollamaLaunchTarget: input.ollamaLaunchTarget ?? null,
      fullAuto: input.fullAuto ?? false,
      dangerouslyBypassApprovalsAndSandbox:
        input.dangerouslyBypassApprovalsAndSandbox ?? false,
      additionalWritableDirs: input.additionalWritableDirs ?? [],
      configOverrides: input.configOverrides ?? [],
      enableFeatures: input.enableFeatures ?? [],
      disableFeatures: input.disableFeatures ?? [],
      skipGitRepoCheck: input.skipGitRepoCheck ?? true,
      ephemeral: input.ephemeral ?? false,
    },
    createdAt: now(),
    updatedAt: now(),
  };
}

export function buildLiveRunState({
  runId,
  session,
  mode,
  command,
  args,
  startedAt,
  child,
  eventQueue,
  workspaceSnapshot,
}: {
  runId: string;
  session: RuntimeSession;
  mode: CodexCommandMode;
  command: string;
  args: string[];
  startedAt: string;
  child: RuntimeChildProcess;
  eventQueue: AsyncEventQueue<RuntimeEvent>;
  workspaceSnapshot: Map<string, RuntimeWorkspaceFileSnapshotEntry>;
}): LiveRuntimeRunState {
  return {
    id: runId,
    sessionId: session.id,
    mode,
    command,
    args,
    startedAt,
    endedAt: null,
    status: "running",
    runtimeSessionId: session.runtimeSessionId,
    rawEvents: [],
    stderr: [],
    errors: [],
    warnings: [],
    messages: [],
    cancelled: false,
    sessionBinding: session.runtimeSessionId
      ? {
          runtimeSessionId: session.runtimeSessionId,
          boundAt: startedAt,
          source: "existing-session",
        }
      : null,
    child,
    eventQueue,
    result: null,
    completion: null,
    exitCode: null,
    signal: null,
    workspaceSnapshot,
  };
}

export function buildRunStart(run: RuntimeRunState): RuntimeRunStart {
  return {
    runId: run.id,
    sessionId: run.sessionId,
    command: run.command,
    args: run.args,
    startedAt: run.startedAt,
    status: run.status,
  };
}
