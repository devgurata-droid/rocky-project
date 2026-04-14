import type {
  NormalizeEventContext,
  RuntimeEvent,
} from "./runtime-types.js";

function extractTextParts(value: unknown, parts: string[] = []): string[] {
  if (typeof value === "string") {
    parts.push(value);
    return parts;
  }

  if (!value || typeof value !== "object") {
    return parts;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      extractTextParts(item, parts);
    }
    return parts;
  }

  const record = value as Record<string, unknown>;

  for (const key of ["text", "delta", "message", "value"]) {
    if (typeof record[key] === "string") {
      parts.push(record[key] as string);
    }
  }

  for (const key of ["content", "items", "output"]) {
    if (record[key]) {
      extractTextParts(record[key], parts);
    }
  }

  return parts;
}

function buildBaseEvent(
  rawEvent: any,
  context: Required<NormalizeEventContext>
): RuntimeEvent {
  return {
    source: "codex-cli",
    type: "run.raw",
    runId: context.runId,
    sessionId: context.sessionId,
    runtimeSessionId: context.runtimeSessionId ?? null,
    rawType: rawEvent?.type ?? "unknown",
    occurredAt: context.now(),
    data: {},
    raw: rawEvent,
  };
}

export function normalizeCodexEvent(
  rawEvent: any,
  context: NormalizeEventContext = {}
): RuntimeEvent {
  const normalizedContext: Required<NormalizeEventContext> = {
    runId: context.runId ?? null,
    sessionId: context.sessionId ?? null,
    runtimeSessionId: context.runtimeSessionId ?? null,
    now: context.now ?? (() => new Date().toISOString()),
  };

  const base = buildBaseEvent(rawEvent, normalizedContext);

  if (!rawEvent || typeof rawEvent !== "object") {
    return base;
  }

  if (rawEvent.type === "thread.started") {
    return {
      ...base,
      type: "session.bound",
      runtimeSessionId: rawEvent.thread_id ?? null,
      data: {
        runtimeSessionId: rawEvent.thread_id ?? null,
      },
    };
  }

  if (rawEvent.type === "turn.started") {
    return {
      ...base,
      type: "run.started",
    };
  }

  if (rawEvent.type === "error") {
    const message = rawEvent.message ?? "";
    const retriable = /reconnecting/i.test(message);

    return {
      ...base,
      type: retriable ? "run.warning" : "run.error",
      data: {
        message,
        retriable,
      },
    };
  }

  if (rawEvent.type === "item.completed" && rawEvent.item?.type === "error") {
    return {
      ...base,
      type: "run.warning",
      data: {
        message: rawEvent.item.message ?? "",
        retriable: false,
      },
    };
  }

  if (typeof rawEvent.delta === "string" && rawEvent.type?.endsWith(".delta")) {
    return {
      ...base,
      type: "assistant.message.delta",
      data: {
        text: rawEvent.delta,
      },
    };
  }

  if (rawEvent.type === "item.completed") {
    const text = extractTextParts(rawEvent.item).join("").trim();
    if (text) {
      return {
        ...base,
        type: "assistant.message.completed",
        data: {
          text,
          itemType: rawEvent.item?.type ?? null,
        },
      };
    }
  }

  if (rawEvent.type === "turn.completed") {
    return {
      ...base,
      type: "run.completed",
    };
  }

  return base;
}
