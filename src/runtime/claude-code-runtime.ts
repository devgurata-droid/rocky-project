import { spawn as defaultSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { AsyncEventQueue } from "./async-event-queue.js";
import { buildClaudeCodeCommand } from "./claude-command.js";
import {
  attachLineReader,
  buildLiveRunState,
  buildRunStart,
  buildRuntimeSession,
  type LiveRuntimeRunState,
} from "./codex-runtime-helpers.js";
import {
  DEFAULT_RUNTIME_CAPABILITIES,
  RuntimeAdapter,
} from "./runtime-adapter.js";

import type {
  CodexCommandMode,
  RuntimeCapabilities,
  RuntimeChildProcess,
  RuntimeEvent,
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

export const CLAUDE_CODE_RUNTIME_CAPABILITIES: Readonly<RuntimeCapabilities> =
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

function buildCompletionResult(
  run: RuntimeRunState,
  session: RuntimeSession
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

export class ClaudeCodeRuntime extends RuntimeAdapter {
  private readonly spawnImpl: SpawnLike;
  private readonly now: () => string;
  private readonly idGenerator: () => string;
  private readonly baseEnv: NodeJS.ProcessEnv;
  private readonly sessions = new Map<string, RuntimeSession>();
  private readonly runs = new Map<string, RuntimeRunState>();

  constructor(options: RuntimeOptions = {}) {
    super();
    this.spawnImpl = (options.spawn ??
      (defaultSpawn as unknown as SpawnLike));
    this.now = options.now ?? (() => new Date().toISOString());
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.baseEnv = options.baseEnv ?? process.env;
  }

  async createSession(input: RuntimeSessionInput): Promise<RuntimeSession> {
    if (!input.workspaceRoot) {
      throw new Error("createSession() requires workspaceRoot");
    }

    const session = buildRuntimeSession(input, this.now, this.idGenerator, {
      kind: "claude-code",
      defaultRuntimeHomeDirname: "claude",
      defaultBin: "claude",
    });

    this.sessions.set(session.id, session);
    return session;
  }

  listCapabilities(): Readonly<RuntimeCapabilities> {
    return CLAUDE_CODE_RUNTIME_CAPABILITIES;
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

  private requireRun(runId: string): RuntimeRunState & {
    eventQueue: AsyncEventQueue<RuntimeEvent>;
  } {
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
    const runId = request.runId ?? this.idGenerator();
    const eventQueue = new AsyncEventQueue<RuntimeEvent>();
    const startedAt = this.now();
    const { command, args } = buildClaudeCodeCommand({
      mode,
      session,
      request,
    });
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
      this.handleOutputLine(run, session, eventQueue, line);
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
        run.result = buildCompletionResult(run, session);
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

  private handleOutputLine(
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
        ? ((parsed.event as { type: string }).type)
        : typeof parsed.type === "string"
          ? parsed.type
          : typeof parsed.event === "string"
            ? parsed.event
          : "stream-json";

    const sessionId =
      typeof parsed.session_id === "string"
        ? parsed.session_id
        : typeof parsed.sessionId === "string"
          ? parsed.sessionId
          : null;
    if (sessionId && run.runtimeSessionId !== sessionId) {
      run.runtimeSessionId = sessionId;
      session.runtimeSessionId = sessionId;
      run.sessionBinding = {
        runtimeSessionId: sessionId,
        boundAt: occurredAt,
        source: "claude-code",
      };
      eventQueue.push({
        source: "claude-code",
        type: "session.bound",
        runId: run.id,
        sessionId: session.id,
        runtimeSessionId: sessionId,
        rawType,
        occurredAt,
        data: {
          runtimeSessionId: sessionId,
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
