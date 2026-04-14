import { normalizeCodexEvent } from "./codex-event-normalizer.js";
import { attachLineReader } from "./codex-runtime-helpers.js";

import type {
  RuntimeEvent,
  RuntimeSession,
} from "./runtime-types.js";
import type { LiveRuntimeRunState } from "./codex-runtime-helpers.js";

function pushStdoutLineEvent({
  line,
  runId,
  session,
  eventQueue,
  now,
}: {
  line: string;
  runId: string;
  session: RuntimeSession;
  eventQueue: { push(value: RuntimeEvent): void };
  now: () => string;
}): void {
  eventQueue.push({
    source: "codex-cli",
    type: "run.stdout",
    runId,
    sessionId: session.id,
    runtimeSessionId: session.runtimeSessionId,
    rawType: "stdout.line",
    occurredAt: now(),
    data: { line },
    raw: line,
  });
}

function handleNormalizedEvent({
  normalized,
  run,
  session,
  eventQueue,
  now,
}: {
  normalized: RuntimeEvent;
  run: LiveRuntimeRunState;
  session: RuntimeSession;
  eventQueue: { push(value: RuntimeEvent): void };
  now: () => string;
}): void {
  if (
    normalized.type === "session.bound" &&
    normalized.data.runtimeSessionId
  ) {
    const runtimeSessionId = String(normalized.data.runtimeSessionId);
    session.runtimeSessionId = runtimeSessionId;
    session.updatedAt = now();
    run.runtimeSessionId = runtimeSessionId;
    run.sessionBinding = {
      runtimeSessionId,
      boundAt: normalized.occurredAt,
      source: normalized.rawType,
    };
  }

  if (normalized.type === "run.warning") {
    run.warnings.push({
      ...normalized.data,
      occurredAt: normalized.occurredAt,
    });
  }

  if (normalized.type === "run.error") {
    run.errors.push(String(normalized.data.message ?? ""));
  }

  if (normalized.type === "assistant.message.completed") {
    run.messages.push({
      role: "assistant",
      text: String(normalized.data.text ?? ""),
      itemType:
        normalized.data.itemType === null ||
        normalized.data.itemType === undefined
          ? null
          : String(normalized.data.itemType),
      occurredAt: normalized.occurredAt,
      source: normalized.rawType,
    });
  }

  eventQueue.push(normalized);
}

function handleStdoutLine({
  line,
  runId,
  run,
  session,
  eventQueue,
  now,
}: {
  line: string;
  runId: string;
  run: LiveRuntimeRunState;
  session: RuntimeSession;
  eventQueue: { push(value: RuntimeEvent): void };
  now: () => string;
}): void {
  if (!line.trim()) {
    return;
  }

  let rawEvent: any;
  try {
    rawEvent = JSON.parse(line);
  } catch {
    pushStdoutLineEvent({
      line,
      runId,
      session,
      eventQueue,
      now,
    });
    return;
  }

  run.rawEvents.push(rawEvent);

  handleNormalizedEvent({
    normalized: normalizeCodexEvent(rawEvent, {
      runId,
      sessionId: session.id,
      runtimeSessionId: session.runtimeSessionId,
      now,
    }),
    run,
    session,
    eventQueue,
    now,
  });
}

function handleStderrLine({
  line,
  runId,
  run,
  session,
  eventQueue,
  now,
}: {
  line: string;
  runId: string;
  run: LiveRuntimeRunState;
  session: RuntimeSession;
  eventQueue: { push(value: RuntimeEvent): void };
  now: () => string;
}): void {
  if (!line.trim()) {
    return;
  }

  run.stderr.push(line);
  eventQueue.push({
    source: "codex-cli",
    type: "run.stderr",
    runId,
    sessionId: session.id,
    runtimeSessionId: session.runtimeSessionId,
    rawType: "stderr.line",
    occurredAt: now(),
    data: {
      line,
      level: /\bERROR\b/.test(line) ? "error" : "info",
    },
    raw: line,
  });
}

export function registerCodexRunStreamHandlers({
  child,
  runId,
  run,
  session,
  eventQueue,
  now,
}: {
  child: RuntimeSession["runtimeKind"] extends string ? {
    stdout: NodeJS.ReadableStream;
    stderr: NodeJS.ReadableStream;
  } : never;
  runId: string;
  run: LiveRuntimeRunState;
  session: RuntimeSession;
  eventQueue: { push(value: RuntimeEvent): void };
  now: () => string;
}): void {
  attachLineReader(child.stdout, (line) => {
    handleStdoutLine({
      line,
      runId,
      run,
      session,
      eventQueue,
      now,
    });
  });

  attachLineReader(child.stderr, (line) => {
    handleStderrLine({
      line,
      runId,
      run,
      session,
      eventQueue,
      now,
    });
  });
}
