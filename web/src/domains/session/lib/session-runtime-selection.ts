import type {
  RuntimeKind,
  RuntimeOllamaLaunchTarget,
} from "@/shared/lib/agent-engine-client";

const STORAGE_KEY_PREFIX = "agent-engine:session-runtime-selection:";

export interface SessionRuntimeSelection {
  runtimeKind: RuntimeKind;
  ollamaLaunchTarget: RuntimeOllamaLaunchTarget | null;
  model: string | null;
  reasoningEffort: string | null;
  serviceTier: string | null;
}

function storageKey(sessionId: string): string {
  return `${STORAGE_KEY_PREFIX}${sessionId}`;
}

function isRuntimeKind(value: unknown): value is RuntimeKind {
  return value === "codex-cli" || value === "claude-code" || value === "ollama";
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" ? value : value === null ? null : null;
}

function normalizeOllamaLaunchTarget(value: unknown): RuntimeOllamaLaunchTarget | null {
  return value === "codex" || value === "claude" ? value : null;
}

export function readSessionRuntimeSelection(
  sessionId: string
): SessionRuntimeSelection | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(storageKey(sessionId));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<SessionRuntimeSelection> | null;
    if (!parsed || !isRuntimeKind(parsed.runtimeKind)) {
      return null;
    }

    return {
      runtimeKind: parsed.runtimeKind,
      ollamaLaunchTarget: normalizeOllamaLaunchTarget(parsed.ollamaLaunchTarget),
      model: normalizeString(parsed.model),
      reasoningEffort: normalizeString(parsed.reasoningEffort),
      serviceTier: normalizeString(parsed.serviceTier),
    };
  } catch {
    return null;
  }
}

export function writeSessionRuntimeSelection(
  sessionId: string,
  selection: SessionRuntimeSelection
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(storageKey(sessionId), JSON.stringify(selection));
  } catch {
    // Ignore local storage failures.
  }
}
