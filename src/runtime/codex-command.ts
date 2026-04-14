import type {
  CodexCommand,
  CodexCommandMode,
  RuntimeRequest,
  RuntimeSession,
} from "./runtime-types.js";
import { normalizeRuntimeServiceTier } from "./runtime-types.js";

const OLLAMA_CODEX_PROFILE = "ollama-launch";

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function isReservedConfigOverride(entry: string): boolean {
  return /^(model_reasoning_effort|service_tier)\s*=/.test(entry.trim());
}

function resolveSandboxMode(session: RuntimeSession): string | null {
  if (session.config.fullAuto) {
    return "workspace-write";
  }

  return session.config.sandbox;
}

function shouldBypassApprovalsAndSandbox(
  session: RuntimeSession,
  request: RuntimeRequest
): boolean {
  if (typeof request.dangerouslyBypassApprovalsAndSandbox === "boolean") {
    return request.dangerouslyBypassApprovalsAndSandbox;
  }

  return session.config.dangerouslyBypassApprovalsAndSandbox;
}

function resolveApprovalPolicy(
  session: RuntimeSession,
  request: RuntimeRequest
): string | null {
  if (shouldBypassApprovalsAndSandbox(session, request)) {
    return null;
  }

  if (session.config.fullAuto) {
    return "never";
  }

  const approval = session.config.approval;
  if (!approval) {
    return null;
  }

  // `codex exec` in this service runs without an interactive approver.
  // Policies that depend on escalation dead-end into failed shell writes.
  if (approval === "untrusted" || approval === "on-failure" || approval === "on-request") {
    return "never";
  }

  return approval;
}

function buildGlobalArgs(
  session: RuntimeSession,
  request: RuntimeRequest
): string[] {
  const args: string[] = [];
  const globalConfig = session.config;
  const approvalPolicy = resolveApprovalPolicy(session, request);

  if (approvalPolicy) {
    args.push("--ask-for-approval", approvalPolicy);
  }

  if (shouldBypassApprovalsAndSandbox(session, request)) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  }

  return args;
}

function buildScopedArgs(
  session: RuntimeSession,
  request: RuntimeRequest
): string[] {
  const args: string[] = [];
  const globalConfig = session.config;
  const sandboxMode = resolveSandboxMode(session);

  if (session.workspaceRoot) {
    args.push("-C", session.workspaceRoot);
  }

  if (globalConfig.profile) {
    args.push("--profile", globalConfig.profile);
  }

  if (globalConfig.model) {
    args.push("--model", globalConfig.model);
  }

  if (sandboxMode) {
    args.push("--sandbox", sandboxMode);
  }

  for (const dir of uniqueStrings([
    ...(globalConfig.additionalWritableDirs ?? []),
    ...(request.additionalWritableDirs ?? []),
  ])) {
    args.push("--add-dir", dir);
  }
  appendConfigAndFeatureArgs(args, session, request);
  return args;
}

function appendConfigAndFeatureArgs(
  args: string[],
  session: RuntimeSession,
  request: RuntimeRequest
): void {
  const globalConfig = session.config;

  for (const configEntry of [
    ...(globalConfig.configOverrides ?? []),
    ...(request.configOverrides ?? []),
  ]) {
    if (isReservedConfigOverride(configEntry)) {
      continue;
    }
    args.push("-c", configEntry);
  }

  if (globalConfig.reasoningEffort) {
    args.push("-c", `model_reasoning_effort="${globalConfig.reasoningEffort}"`);
  }

  const normalizedServiceTier = normalizeRuntimeServiceTier(globalConfig.serviceTier);
  if (normalizedServiceTier) {
    args.push("-c", `service_tier="${normalizedServiceTier}"`);
  }

  for (const feature of [
    ...(globalConfig.enableFeatures ?? []),
    ...(request.enableFeatures ?? []),
  ]) {
    args.push("--enable", feature);
  }

  for (const feature of [
    ...(globalConfig.disableFeatures ?? []),
    ...(request.disableFeatures ?? []),
  ]) {
    args.push("--disable", feature);
  }
}

function buildResumeArgs(
  session: RuntimeSession,
  request: RuntimeRequest
): string[] {
  const args = ["exec", "resume"];
  const globalConfig = session.config;

  if (globalConfig.model) {
    args.push("--model", globalConfig.model);
  }

  // `codex exec resume` does not reliably honor a top-level `--profile`
  // for the Ollama launch profile, so restate the provider directly.
  if (globalConfig.profile === OLLAMA_CODEX_PROFILE) {
    args.push("-c", `model_provider="${OLLAMA_CODEX_PROFILE}"`);
  }

  appendConfigAndFeatureArgs(args, session, request);

  return args;
}

function buildExecArgs(
  mode: CodexCommandMode,
  session: RuntimeSession,
  request: RuntimeRequest
): string[] {
  const args =
    mode === "exec"
      ? ["exec", ...buildScopedArgs(session, request)]
      : buildResumeArgs(session, request);

  args.push("--json");

  if (mode === "exec") {
    args.push("--color", "never");
  }

  if (request.skipGitRepoCheck || session.config.skipGitRepoCheck) {
    args.push("--skip-git-repo-check");
  }

  if (request.ephemeral || session.config.ephemeral) {
    args.push("--ephemeral");
  }

  if (request.outputLastMessagePath) {
    args.push("--output-last-message", request.outputLastMessagePath);
  }

  for (const imagePath of request.images ?? []) {
    args.push("-i", imagePath);
  }

  if (mode === "resume") {
    if (!session.runtimeSessionId) {
      throw new Error("resumeSession() requires session.runtimeSessionId");
    }
    args.push(session.runtimeSessionId);
  }

  args.push(request.prompt);
  return args;
}

export function buildCodexCommand({
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

  return {
    command: session.config.codexBin,
    args: [
      ...buildGlobalArgs(session, request),
      ...buildExecArgs(mode, session, request),
    ],
  };
}
