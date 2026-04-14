import { spawn as defaultSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { AsyncEventQueue } from "./async-event-queue.js";
import { buildClaudeCodeCommand } from "./claude-command.js";
import { buildCodexCommand } from "./codex-command.js";
import { createWorkspaceSnapshot } from "./codex-runtime-artifacts.js";
import { createCodexRunCompletion } from "./codex-runtime-completion.js";
import {
  attachLineReader,
  buildLiveRunState,
  buildRunStart,
  buildRuntimeSession,
  type LiveRuntimeRunState,
} from "./codex-runtime-helpers.js";
import {
  prepareCodexRuntimeEnvironment,
  shouldUseSharedHomeForWritableSandbox,
} from "./codex-runtime-environment.js";
import { registerCodexRunStreamHandlers } from "./codex-runtime-events.js";
import {
  DEFAULT_RUNTIME_CAPABILITIES,
  RuntimeAdapter,
} from "./runtime-adapter.js";
import { OllamaModelCatalog } from "./ollama-model-catalog.js";

import type {
  CodexCommandMode,
  RuntimeCapabilities,
  RuntimeChildProcess,
  RuntimeEvent,
  RuntimeOllamaLaunchTarget,
  RuntimeOptions,
  RuntimeRequest,
  RuntimeRunResult,
  RuntimeRunStart,
  RuntimeRunState,
  RuntimeSession,
  RuntimeSessionInput,
  RuntimeWorkspaceFileSnapshotEntry,
  SpawnLike,
} from "./runtime-types.js";

export const OLLAMA_RUNTIME_CAPABILITIES: Readonly<RuntimeCapabilities> =
  Object.freeze({
    ...DEFAULT_RUNTIME_CAPABILITIES,
    streaming: true,
    resumeSession: true,
    shellExecution: true,
    fileMutation: true,
    approvalFlow: true,
    durableSessionState: true,
    structuredEvents: true,
    skillInjection: true,
  });

export const OLLAMA_CODEX_PROFILE = "ollama-launch";

function buildEmptyWorkspaceSnapshot(): Map<string, RuntimeWorkspaceFileSnapshotEntry> {
  return new Map();
}

function extractTextFromContent(content: unknown): string | null {
  if (typeof content === "string") {
    const text = content.trim();
    return text.length > 0 ? text : null;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const parts = content
    .flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }

      const text =
        typeof (item as { text?: unknown }).text === "string"
          ? (item as { text: string }).text
          : null;
      return text ? [text] : [];
    })
    .join("")
    .trim();

  return parts.length > 0 ? parts : null;
}

function extractStreamDeltaText(parsed: Record<string, unknown>): string | null {
  const nestedEvent =
    parsed.type === "stream_event" &&
    parsed.event &&
    typeof parsed.event === "object" &&
    !Array.isArray(parsed.event)
      ? (parsed.event as Record<string, unknown>)
      : null;
  const streamEvent =
    nestedEvent && typeof nestedEvent.type === "string"
      ? nestedEvent.type
      : parsed.type === "stream_event" && typeof parsed.subtype === "string"
        ? parsed.subtype
        : null;
  if (streamEvent !== "content_block_delta") {
    return null;
  }

  const delta = nestedEvent?.delta ?? parsed.delta;
  if (!delta || typeof delta !== "object") {
    return null;
  }

  const deltaRecord = delta as Record<string, unknown>;
  if (deltaRecord.type !== "text_delta") {
    return null;
  }

  const text = typeof deltaRecord.text === "string" ? deltaRecord.text : null;
  return text && text.length > 0 ? text : null;
}

function shouldRecordAssistantCompletion(
  run: RuntimeRunState,
  assistantText: string,
  rawType: string
): boolean {
  if (rawType !== "result") {
    return true;
  }

  return run.messages.at(-1)?.text !== assistantText;
}

function buildClaudeCompletionResult(
  run: RuntimeRunState
): RuntimeRunResult {
  const lastMessage = run.messages.at(-1)?.text ?? null;

  return {
    runId: run.id,
    sessionId: run.sessionId,
    runtimeSessionId: run.runtimeSessionId,
    sessionBinding: run.sessionBinding,
    status: run.cancelled ? "cancelled" : run.errors.length > 0 ? "failed" : "completed",
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    exitCode: run.exitCode,
    signal: run.signal,
    command: run.command,
    args: run.args,
    messages: run.messages,
    warnings: run.warnings,
    errors: run.errors,
    stderr: run.stderr,
    artifactRefs: [],
    lastMessage,
    outputLastMessagePath: run.result?.outputLastMessagePath ?? null,
    rawEvents: run.rawEvents,
  };
}

function resolveLaunchTarget(
  session: RuntimeSession
): RuntimeOllamaLaunchTarget {
  return session.config.ollamaLaunchTarget === "claude" ? "claude" : "codex";
}

function buildInnerCodexSession(
  session: RuntimeSession,
  model: string
): RuntimeSession {
  return {
    ...session,
    runtimeKind: "codex-cli",
    config: {
      ...session.config,
      codexBin: "codex",
      profile: OLLAMA_CODEX_PROFILE,
      model,
    },
  };
}

function buildInnerClaudeSession(
  session: RuntimeSession
): RuntimeSession {
  return {
    ...session,
    runtimeKind: "claude-code",
    config: {
      ...session.config,
      codexBin: "claude",
      model: null,
    },
  };
}

function buildOllamaLaunchCommand({
  mode,
  session,
  request,
  model,
}: {
  mode: CodexCommandMode;
  session: RuntimeSession;
  request: RuntimeRequest;
  model: string;
}): {
  target: RuntimeOllamaLaunchTarget;
  command: string;
  args: string[];
} {
  const target = resolveLaunchTarget(session);
  if (target === "claude") {
    const inner = buildClaudeCodeCommand({
      mode,
      session: buildInnerClaudeSession(session),
      request,
    });
    return {
      target,
      command: session.config.codexBin,
      args: ["launch", "claude", "--model", model, "--yes", "--", ...inner.args],
    };
  }

  const inner = buildCodexCommand({
    mode,
    session: buildInnerCodexSession(session, model),
    request,
  });
  return {
    target,
    command: inner.command,
    args: inner.args,
  };
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function buildOllamaCodexProfileStanza(baseUrl: string): string {
  const v1BaseUrl = `${trimTrailingSlash(baseUrl)}/v1/`;

  return [
    `[profiles.${OLLAMA_CODEX_PROFILE}]`,
    `model_provider = "${OLLAMA_CODEX_PROFILE}"`,
    `openai_base_url = "${v1BaseUrl}"`,
    `forced_login_method = "api"`,
    "",
    `[model_providers.${OLLAMA_CODEX_PROFILE}]`,
    `name = "Ollama"`,
    `base_url = "${v1BaseUrl}"`,
    "",
  ].join("\n");
}

function resolveCodexConfigPaths(
  homePath: string,
  xdgConfigHome?: string
): string[] {
  return [
    path.join(homePath, ".codex", "config.toml"),
    ...(xdgConfigHome
      ? [
        path.join(xdgConfigHome, "codex", "config.toml"),
        path.join(xdgConfigHome, ".codex", "config.toml"),
      ]
      : []),
  ].filter((entry, index, entries) => entries.indexOf(entry) === index);
}

async function ensureOllamaCodexProfile({
  homePath,
  xdgConfigHome,
  baseUrl,
}: {
  homePath: string;
  xdgConfigHome?: string;
  baseUrl: string;
}): Promise<void> {
  const profileStanza = buildOllamaCodexProfileStanza(baseUrl);

  for (const configPath of resolveCodexConfigPaths(homePath, xdgConfigHome)) {
    const currentConfig = await readFile(configPath, "utf8").catch(() => "");
    const hasProfile = currentConfig.includes(`[profiles.${OLLAMA_CODEX_PROFILE}]`);
    const hasProvider = currentConfig.includes(
      `[model_providers.${OLLAMA_CODEX_PROFILE}]`
    );

    if (hasProfile && hasProvider) {
      continue;
    }

    await mkdir(path.dirname(configPath), { recursive: true });
    const nextConfig = currentConfig.trim()
      ? `${currentConfig.trimEnd()}\n\n${profileStanza}`
      : profileStanza;
    await writeFile(configPath, nextConfig, "utf8");
  }
}

export class OllamaRuntime extends RuntimeAdapter {
  private readonly spawnImpl: SpawnLike;
  private readonly now: () => string;
  private readonly idGenerator: () => string;
  private readonly baseEnv: NodeJS.ProcessEnv;
  private readonly sessions = new Map<string, RuntimeSession>();
  private readonly runs = new Map<string, RuntimeRunState>();
  private readonly catalog: OllamaModelCatalog;

  constructor(
    options: RuntimeOptions & {
      catalog?: OllamaModelCatalog;
      fetchImpl?: typeof fetch;
      baseUrl?: string;
    } = {}
  ) {
    super();
    this.spawnImpl = (options.spawn ??
      (defaultSpawn as unknown as SpawnLike));
    this.now = options.now ?? (() => new Date().toISOString());
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.baseEnv = options.baseEnv ?? process.env;
    this.catalog =
      options.catalog ??
      new OllamaModelCatalog({
        baseUrl: options.baseUrl,
        fetchImpl: options.fetchImpl,
      });
  }

  async createSession(input: RuntimeSessionInput): Promise<RuntimeSession> {
    if (!input.workspaceRoot) {
      throw new Error("createSession() requires workspaceRoot");
    }

    const session = buildRuntimeSession(input, this.now, this.idGenerator, {
      kind: "ollama",
      defaultRuntimeHomeDirname: "ollama",
      defaultBin: "ollama",
    });

    this.sessions.set(session.id, session);
    return session;
  }

  listCapabilities(): Readonly<RuntimeCapabilities> {
    return OLLAMA_RUNTIME_CAPABILITIES;
  }

  async sendTurn(input: RuntimeRequest): Promise<RuntimeRunStart> {
    const session = this.requireSession(input.sessionId);
    return this.startRun("exec", session, input);
  }

  async resumeSession(input: RuntimeRequest): Promise<RuntimeRunStart> {
    const session = this.requireSession(input.sessionId);
    return this.startRun("resume", session, input);
  }

  async *streamEvents(runId: string): AsyncGenerator<RuntimeEvent> {
    const run = this.requireRun(runId);
    yield* run.eventQueue;
  }

  async cancelRun(runId: string): Promise<void> {
    const run = this.requireRun(runId);
    run.cancelled = true;
    run.child.kill("SIGTERM");
  }

  async getRunResult(runId: string): Promise<RuntimeRunResult> {
    const run = this.requireRun(runId);
    if (!run.completion) {
      throw new Error(`Run has no completion promise: ${runId}`);
    }

    await run.completion;
    if (!run.result) {
      throw new Error(`Run did not produce a result: ${runId}`);
    }

    return run.result;
  }

  private requireSession(sessionId: string): RuntimeSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }

    return session;
  }

  private requireRun(runId: string): LiveRuntimeRunState {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Unknown run: ${runId}`);
    }

    return run as LiveRuntimeRunState;
  }

  private async startRun(
    mode: CodexCommandMode,
    session: RuntimeSession,
    request: RuntimeRequest
  ): Promise<RuntimeRunStart> {
    const installedModels = await this.catalog.listInstalledModels();
    const model = session.config.model?.trim() || installedModels[0] || null;
    if (!model) {
      throw new Error(
        "No installed Ollama model is available. Start Ollama and pull a model first."
      );
    }

    const runId = request.runId ?? this.idGenerator();
    const startedAt = this.now();
    const eventQueue = new AsyncEventQueue<RuntimeEvent>();
    const launchCommand = buildOllamaLaunchCommand({
      mode,
      session,
      request,
      model,
    });

    if (launchCommand.target === "claude") {
      return this.startClaudeLaunchRun({
        runId,
        session,
        request,
        startedAt,
        eventQueue,
        command: launchCommand.command,
        args: launchCommand.args,
        mode,
      });
    }

    return this.startCodexLaunchRun({
      runId,
      session,
      request,
      startedAt,
      eventQueue,
      command: launchCommand.command,
      args: launchCommand.args,
      mode,
    });
  }

  private async startCodexLaunchRun({
    runId,
    session,
    request,
    startedAt,
    eventQueue,
    command,
    args,
    mode,
  }: {
    runId: string;
    session: RuntimeSession;
    request: RuntimeRequest;
    startedAt: string;
    eventQueue: AsyncEventQueue<RuntimeEvent>;
    command: string;
    args: string[];
    mode: CodexCommandMode;
  }): Promise<RuntimeRunStart> {
    const shareHomeWithBaseEnv = shouldUseSharedHomeForWritableSandbox({
      session: buildInnerCodexSession(session, session.config.model?.trim() || ""),
      request,
      baseEnv: this.baseEnv,
      authSource: request.authSource ?? null,
    });
    const preparedEnvironment = await prepareCodexRuntimeEnvironment({
      runtimeHome: session.runtimeHome,
      workspaceRoot: session.workspaceRoot,
      baseEnv: this.baseEnv,
      extraEnv: request.extraEnv ?? {},
      authSource: request.authSource ?? null,
      runtimeSessionId: session.runtimeSessionId,
      seedAuthFromCurrentHome: request.seedAuthFromCurrentHome ?? true,
      shareHomeWithBaseEnv,
      reuseBasePlaywrightBrowsers: false,
    });
    await ensureOllamaCodexProfile({
      homePath: preparedEnvironment.effectiveHome,
      xdgConfigHome: preparedEnvironment.env.XDG_CONFIG_HOME,
      baseUrl: this.catalog.resolveBaseUrl(),
    });
    const workspaceSnapshot = await createWorkspaceSnapshot(session.workspaceRoot);
    const child = this.spawnImpl(command, args, {
      cwd: session.workspaceRoot,
      env: preparedEnvironment.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const run = buildLiveRunState({
      runId,
      session,
      mode,
      command,
      args,
      startedAt,
      child: child as RuntimeChildProcess,
      eventQueue,
      workspaceSnapshot,
    });

    this.runs.set(runId, run);
    registerCodexRunStreamHandlers({
      child,
      runId,
      run,
      session,
      eventQueue,
      now: this.now,
    });
    run.completion = createCodexRunCompletion({
      child,
      runId,
      session,
      run,
      command,
      args,
      request,
      eventQueue,
      now: this.now,
    });

    return buildRunStart(run);
  }

  private async startClaudeLaunchRun({
    runId,
    session,
    request,
    startedAt,
    eventQueue,
    command,
    args,
    mode,
  }: {
    runId: string;
    session: RuntimeSession;
    request: RuntimeRequest;
    startedAt: string;
    eventQueue: AsyncEventQueue<RuntimeEvent>;
    command: string;
    args: string[];
    mode: CodexCommandMode;
  }): Promise<RuntimeRunStart> {
    const child = this.spawnImpl(command, args, {
      cwd: session.workspaceRoot,
      env: {
        ...this.baseEnv,
        ...(request.extraEnv ?? {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const run = buildLiveRunState({
      runId,
      session,
      mode,
      command,
      args,
      startedAt,
      child: child as RuntimeChildProcess,
      eventQueue,
      workspaceSnapshot: buildEmptyWorkspaceSnapshot(),
    });

    this.runs.set(runId, run);
    eventQueue.push({
      source: "claude-code",
      type: "run.started",
      runId,
      sessionId: session.id,
      runtimeSessionId: session.runtimeSessionId,
      rawType: "process.start",
      occurredAt: startedAt,
      data: {
        status: "running",
        mode,
      },
      raw: {
        command,
        args,
      },
    });

    const stdoutReader = attachLineReader(child.stdout, (line) => {
      this.handleClaudeOutputLine(run, session, eventQueue, line);
    });
    const stderrReader = attachLineReader(child.stderr, (line) => {
      run.stderr.push(line);
      eventQueue.push({
        source: "claude-code",
        type: "run.stderr",
        runId,
        sessionId: session.id,
        runtimeSessionId: run.runtimeSessionId,
        rawType: "stderr.line",
        occurredAt: this.now(),
        data: {
          line,
        },
        raw: line,
      });
    });

    run.completion = new Promise<RuntimeRunResult>((resolve, reject) => {
      child.once("error", (error) => {
        run.status = "failed";
        run.endedAt = this.now();
        run.errors.push(error.message);
        eventQueue.push({
          source: "claude-code",
          type: "run.error",
          runId,
          sessionId: session.id,
          runtimeSessionId: run.runtimeSessionId,
          rawType: "process.error",
          occurredAt: run.endedAt,
          data: {
            message: error.message,
          },
          raw: error,
        });
        eventQueue.close();
        reject(error);
      });

      child.once("close", (exitCode, signal) => {
        stdoutReader.close();
        stderrReader.close();
        run.exitCode = exitCode;
        run.signal = signal;
        run.endedAt = this.now();
        if (signal) {
          run.cancelled = true;
        }
        if (exitCode !== 0 && !run.cancelled && run.errors.length === 0) {
          run.errors.push(`Claude Code exited with code ${exitCode ?? "unknown"}.`);
        }
        run.result = buildClaudeCompletionResult(run);
        run.status = run.result.status;
        eventQueue.push({
          source: "claude-code",
          type: "run.completed",
          runId,
          sessionId: session.id,
          runtimeSessionId: run.runtimeSessionId,
          rawType: "process.close",
          occurredAt: run.endedAt,
          data: {
            status: run.result.status,
            exitCode,
            signal,
          },
          raw: {
            exitCode,
            signal,
          },
        });
        eventQueue.close();
        resolve(run.result);
      });
    });

    return buildRunStart(run);
  }

  private handleClaudeOutputLine(
    run: RuntimeRunState,
    session: RuntimeSession,
    eventQueue: AsyncEventQueue<RuntimeEvent>,
    line: string
  ): void {
    const occurredAt = this.now();
    let parsed: Record<string, unknown>;

    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      run.rawEvents.push(line);
      return;
    }

    run.rawEvents.push(parsed);
    const rawType =
      parsed.type === "stream_event" &&
      parsed.event &&
      typeof parsed.event === "object" &&
      !Array.isArray(parsed.event) &&
      typeof (parsed.event as { type?: unknown }).type === "string"
        ? (parsed.event as { type: string }).type
        : typeof parsed.type === "string"
          ? parsed.type
          : typeof parsed.event === "string"
            ? parsed.event
            : "stream-json";

    const runtimeSessionId =
      typeof parsed.session_id === "string"
        ? parsed.session_id
        : typeof parsed.sessionId === "string"
          ? parsed.sessionId
          : null;
    if (runtimeSessionId && run.runtimeSessionId !== runtimeSessionId) {
      run.runtimeSessionId = runtimeSessionId;
      session.runtimeSessionId = runtimeSessionId;
      run.sessionBinding = {
        runtimeSessionId,
        boundAt: occurredAt,
        source: "claude-code",
      };
      eventQueue.push({
        source: "claude-code",
        type: "session.bound",
        runId: run.id,
        sessionId: session.id,
        runtimeSessionId,
        rawType,
        occurredAt,
        data: {
          runtimeSessionId,
        },
        raw: parsed,
      });
    }

    const assistantDelta = extractStreamDeltaText(parsed);
    if (assistantDelta) {
      eventQueue.push({
        source: "claude-code",
        type: "assistant.message.delta",
        runId: run.id,
        sessionId: session.id,
        runtimeSessionId: run.runtimeSessionId,
        rawType,
        occurredAt,
        data: {
          text: assistantDelta,
        },
        raw: parsed,
      });
      return;
    }

    const assistantText =
      extractTextFromContent(parsed.content) ??
      extractTextFromContent((parsed.message as { content?: unknown } | undefined)?.content) ??
      (typeof parsed.result === "string" ? parsed.result.trim() || null : null);

    if (assistantText && rawType !== "result") {
      run.messages.push({
        role: "assistant",
        text: assistantText,
        itemType: "text",
        occurredAt,
        source: "claude-code",
      });
      eventQueue.push({
        source: "claude-code",
        type: "assistant.message.completed",
        runId: run.id,
        sessionId: session.id,
        runtimeSessionId: run.runtimeSessionId,
        rawType,
        occurredAt,
        data: {
          text: assistantText,
        },
        raw: parsed,
      });
      return;
    }

    if (
      rawType === "result" &&
      assistantText &&
      shouldRecordAssistantCompletion(run, assistantText, rawType)
    ) {
      run.messages.push({
        role: "assistant",
        text: assistantText,
        itemType: "text",
        occurredAt,
        source: "claude-code",
      });
      eventQueue.push({
        source: "claude-code",
        type: "assistant.message.completed",
        runId: run.id,
        sessionId: session.id,
        runtimeSessionId: run.runtimeSessionId,
        rawType,
        occurredAt,
        data: {
          text: assistantText,
        },
        raw: parsed,
      });
    }
  }
}
