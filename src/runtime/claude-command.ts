import type {
  CodexCommand,
  CodexCommandMode,
  RuntimeRequest,
  RuntimeSession,
} from "./runtime-types.js";

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function shouldSkipPermissions(
  session: RuntimeSession,
  request: RuntimeRequest
): boolean {
  if (typeof request.dangerouslyBypassApprovalsAndSandbox === "boolean") {
    return request.dangerouslyBypassApprovalsAndSandbox;
  }

  return session.config.dangerouslyBypassApprovalsAndSandbox;
}

function resolvePermissionMode(session: RuntimeSession): string {
  if (session.config.fullAuto || session.config.approval === "never") {
    return "bypassPermissions";
  }

  return "acceptEdits";
}

function resolveClaudeEffort(
  value: RuntimeSession["config"]["reasoningEffort"]
): "low" | "medium" | "high" | "max" | null {
  if (value === "xhigh") {
    return "max";
  }

  return value === "low" || value === "medium" || value === "high" || value === "max"
    ? value
    : null;
}

export function buildClaudeCodeCommand({
  mode = "exec",
  session,
  request,
}: {
  mode?: CodexCommandMode;
  session: RuntimeSession;
  request: RuntimeRequest;
}): CodexCommand {
  if (!request.prompt || typeof request.prompt !== "string") {
    throw new Error("A non-empty prompt is required");
  }

  const args: string[] = [
    "--print",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
  ];

  if (session.config.model) {
    args.push("--model", session.config.model);
  }

  const effort = resolveClaudeEffort(session.config.reasoningEffort);
  if (effort) {
    args.push("--effort", effort);
  }

  if (shouldSkipPermissions(session, request)) {
    args.push("--dangerously-skip-permissions");
  } else {
    args.push("--permission-mode", resolvePermissionMode(session));
  }

  for (const dir of uniqueStrings([
    session.workspaceRoot,
    ...(session.config.additionalWritableDirs ?? []),
    ...(request.additionalWritableDirs ?? []),
  ])) {
    args.push(`--add-dir=${dir}`);
  }

  if (mode === "resume") {
    if (!session.runtimeSessionId) {
      throw new Error("resumeSession() requires session.runtimeSessionId");
    }
    args.push("--resume", session.runtimeSessionId);
  }

  args.push(request.prompt);

  return {
    command: session.config.codexBin,
    args,
  };
}
