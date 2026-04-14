import type { AgentSessionRecord } from "../types";

export type TaskRequestStatus = "pending" | "running" | "completed" | "failed";

export interface TaskRequestStatusMeta {
  label: string;
  className: string;
}

const STATUS_META: Record<TaskRequestStatus, TaskRequestStatusMeta> = {
  pending: {
    label: "대기",
    className: "border-border bg-secondary text-secondary-foreground",
  },
  running: {
    label: "진행 중",
    className:
      "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300",
  },
  completed: {
    label: "완료",
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  failed: {
    label: "실패",
    className:
      "border-destructive/20 bg-destructive/10 text-destructive dark:border-destructive/30 dark:bg-destructive/20 dark:text-destructive",
  },
};

function compareTaskRequests(
  left: AgentSessionRecord,
  right: AgentSessionRecord
): number {
  return (
    right.lastActivityAt.localeCompare(left.lastActivityAt) ||
    right.createdAt.localeCompare(left.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

function hasStartedWork(session: AgentSessionRecord): boolean {
  return (
    session.runtimeSessionId !== null ||
    session.lastActivityAt !== session.createdAt
  );
}

export function getTaskRequestStatus(
  session: AgentSessionRecord
): TaskRequestStatus {
  if (session.status === "running") {
    return "running";
  }

  if (session.status === "failed" || session.status === "cancelled") {
    return "failed";
  }

  return hasStartedWork(session) ? "completed" : "pending";
}

export function getTaskRequestStatusMeta(
  status: TaskRequestStatus
): TaskRequestStatusMeta {
  return STATUS_META[status];
}

export function getTaskRequestLabel(session: AgentSessionRecord): string {
  return session.title?.trim() || session.id;
}

export function sortTaskRequestsByRecentActivity(
  sessions: AgentSessionRecord[]
): AgentSessionRecord[] {
  return [...sessions].sort(compareTaskRequests);
}

export function getRunningTaskRequests(
  sessions: AgentSessionRecord[]
): AgentSessionRecord[] {
  return sortTaskRequestsByRecentActivity(sessions).filter(
    (session) => getTaskRequestStatus(session) === "running"
  );
}

export function summarizeTaskRequestPrompt(
  prompt: string,
  maxLength = 36
): string {
  const normalized = prompt
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "새 작업 요청";
  }

  const firstSentence =
    normalized.split(/(?<=[.!?])\s+/).find((sentence) => sentence.trim()) ??
    normalized;

  if (firstSentence.length <= maxLength) {
    return firstSentence;
  }

  const boundary = firstSentence.lastIndexOf(" ", maxLength - 3);
  if (boundary >= Math.floor(maxLength * 0.6)) {
    return `${firstSentence.slice(0, boundary).trim()}...`;
  }

  return `${firstSentence.slice(0, maxLength - 3).trim()}...`;
}

export function deriveAgentFocusAreas(description: string): string[] {
  const normalized = description.trim();
  if (!normalized) {
    return [];
  }

  const tokens = normalized
    .split(/[,\n/|·•]/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length >= 2) {
    return [...new Set(tokens)].slice(0, 3);
  }

  if (normalized.length <= 28) {
    return [normalized];
  }

  return [];
}

export function summarizeTaskRequests(sessions: AgentSessionRecord[]) {
  const sorted = sortTaskRequestsByRecentActivity(sessions);

  const current =
    sorted.find((session) => getTaskRequestStatus(session) === "running") ?? null;
  const pending =
    sorted.find((session) => getTaskRequestStatus(session) === "pending") ?? null;
  const recentCompleted =
    sorted.find((session) => getTaskRequestStatus(session) === "completed") ?? null;
  const recentFailed =
    sorted.find((session) => getTaskRequestStatus(session) === "failed") ?? null;

  const counts = sorted.reduce(
    (acc, session) => {
      const status = getTaskRequestStatus(session);
      acc.total += 1;
      acc[status] += 1;
      if (session.lifecycle === "archived") {
        acc.archived += 1;
      }
      return acc;
    },
    {
      total: 0,
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      archived: 0,
    }
  );

  return {
    latest: sorted[0] ?? null,
    current,
    pending,
    recentCompleted,
    recentFailed,
    counts,
  };
}
