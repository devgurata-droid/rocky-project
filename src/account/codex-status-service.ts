import { readdir as defaultReaddir, readFile as defaultReadFile } from "node:fs/promises";
import path from "node:path";

import type { Dirent } from "node:fs";

import type { CodexAccountRecord, CodexAccountServiceLike } from "./codex-account-types.js";
import type {
  CodexStatusAccountSummaryRecord,
  CodexStatusDataState,
  CodexStatusRecord,
  CodexStatusServiceLike,
  CodexStatusUsageWindowRecord,
} from "./codex-status-types.js";
import type { CliVersionDiagnosticsRecord } from "./provider-account-types.js";

interface CodexStatusServiceOptions {
  accountService: CodexAccountServiceLike;
  readFile?: ReadFileLike;
  readdir?: ReaddirLike;
  listSessionLogPaths?: ListSessionLogPathsLike;
  now?: () => string;
  baseEnv?: NodeJS.ProcessEnv;
}

type ReadFileLike = (filePath: string, encoding: BufferEncoding) => Promise<string>;
type ReaddirLike = (
  directoryPath: string,
  options: { withFileTypes: true }
) => Promise<Dirent[]>;
type ListSessionLogPathsLike = (sessionRootPath: string) => Promise<string[]>;

interface UsageWindowSnapshot {
  windowMinutes: number;
  usedPercent: number | null;
  remainingPercent: number | null;
  resetAt: string | null;
}

interface UsageSnapshot {
  refreshedAt: string;
  fiveHour: UsageWindowSnapshot | null;
  weekly: UsageWindowSnapshot | null;
}

const FIVE_HOUR_WINDOW_MINUTES = 300;
const WEEKLY_WINDOW_MINUTES = 10080;
const STALE_AFTER_MINUTES = 30;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampPercent(value: number | null): number | null {
  if (value === null) {
    return null;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
}

function emptyWindow(
  windowMinutes: number,
  status: CodexStatusDataState
): CodexStatusUsageWindowRecord {
  return {
    status,
    windowMinutes,
    usedPercent: null,
    remainingPercent: null,
    resetAt: null,
  };
}

function emptyStatusRecord(
  account: CodexStatusAccountSummaryRecord,
  diagnostics: CliVersionDiagnosticsRecord,
  model: string | null,
  reasoningEffort: string | null,
  status: CodexStatusDataState,
  statusText: string
): CodexStatusRecord {
  return {
    provider: "codex",
    account,
    diagnostics,
    model,
    reasoningEffort,
    fiveHour: emptyWindow(FIVE_HOUR_WINDOW_MINUTES, status),
    weekly: emptyWindow(WEEKLY_WINDOW_MINUTES, status),
    usageSummary: null,
    refreshedAt: null,
    status,
    statusText,
  };
}

function summarizeAccount(account: CodexAccountRecord): CodexStatusAccountSummaryRecord {
  return {
    status: account.status,
    statusText: account.statusText,
    label:
      account.accountInfo.label ??
      account.accountInfo.email ??
      account.accountInfo.name ??
      null,
    authMode: account.accountInfo.authMode,
    planType: account.accountInfo.planType,
  };
}

function extractTomlString(content: string, key: string): string | null {
  const pattern = new RegExp(`^${key}\\s*=\\s*([\"'])(.*?)\\1\\s*$`, "m");
  return content.match(pattern)?.[2] ?? null;
}

function parseConfig(content: string): {
  model: string | null;
  reasoningEffort: string | null;
} {
  return {
    model: extractTomlString(content, "model"),
    reasoningEffort: extractTomlString(content, "model_reasoning_effort"),
  };
}

function parseWindowSnapshot(rawWindow: unknown): UsageWindowSnapshot | null {
  if (!isRecord(rawWindow)) {
    return null;
  }

  const windowMinutes = readFiniteNumber(rawWindow.window_minutes);
  if (windowMinutes === null) {
    return null;
  }

  const usedPercent = clampPercent(readFiniteNumber(rawWindow.used_percent));
  const resetSeconds = readFiniteNumber(rawWindow.resets_at);
  const resetAt =
    resetSeconds === null ? null : new Date(resetSeconds * 1000).toISOString();

  return {
    windowMinutes,
    usedPercent,
    remainingPercent:
      usedPercent === null ? null : clampPercent(100 - usedPercent),
    resetAt,
  };
}

function parseUsageSnapshot(logContent: string): UsageSnapshot | null {
  const lines = logContent.split(/\r?\n/);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }

    try {
      const parsed = JSON.parse(line);
      if (!isRecord(parsed) || parsed.type !== "event_msg") {
        continue;
      }

      const payload = isRecord(parsed.payload) ? parsed.payload : null;
      if (!payload || payload.type !== "token_count") {
        continue;
      }

      const rateLimits = isRecord(payload.rate_limits) ? payload.rate_limits : null;
      if (!rateLimits) {
        continue;
      }

      const windows = [
        parseWindowSnapshot(rateLimits.primary),
        parseWindowSnapshot(rateLimits.secondary),
      ].filter((window): window is UsageWindowSnapshot => window !== null);

      const refreshedAt = readNonEmptyString(parsed.timestamp);
      if (!refreshedAt) {
        continue;
      }

      return {
        refreshedAt,
        fiveHour:
          windows.find((window) => window.windowMinutes === FIVE_HOUR_WINDOW_MINUTES) ??
          null,
        weekly:
          windows.find((window) => window.windowMinutes === WEEKLY_WINDOW_MINUTES) ??
          null,
      };
    } catch {
      continue;
    }
  }

  return null;
}

function isNewerSnapshot(
  candidate: UsageSnapshot,
  current: UsageSnapshot | null
): boolean {
  if (!current) {
    return true;
  }

  const candidateTime = new Date(candidate.refreshedAt).getTime();
  const currentTime = new Date(current.refreshedAt).getTime();
  if (Number.isNaN(candidateTime)) {
    return false;
  }

  if (Number.isNaN(currentTime)) {
    return true;
  }

  return candidateTime > currentTime;
}

function freshnessState(refreshedAt: string, now: string): CodexStatusDataState {
  const refreshedTime = new Date(refreshedAt).getTime();
  const currentTime = new Date(now).getTime();
  if (Number.isNaN(refreshedTime) || Number.isNaN(currentTime)) {
    return "unavailable";
  }

  const ageMinutes = (currentTime - refreshedTime) / 60000;
  return ageMinutes > STALE_AFTER_MINUTES ? "stale" : "ok";
}

function mergeStatus(...states: CodexStatusDataState[]): CodexStatusDataState {
  const ranking: Record<CodexStatusDataState, number> = {
    ok: 0,
    stale: 1,
    unavailable: 2,
    error: 3,
  };

  return states.reduce((current, next) =>
    ranking[next] > ranking[current] ? next : current
  );
}

function withWindowState(
  snapshot: UsageWindowSnapshot | null,
  fallbackWindowMinutes: number,
  state: CodexStatusDataState
): CodexStatusUsageWindowRecord {
  if (!snapshot) {
    return emptyWindow(fallbackWindowMinutes, state === "error" ? "error" : "unavailable");
  }

  return {
    status: state,
    windowMinutes: snapshot.windowMinutes,
    usedPercent: snapshot.usedPercent,
    remainingPercent: snapshot.remainingPercent,
    resetAt: snapshot.resetAt,
  };
}

async function defaultListSessionLogPaths(
  sessionRootPath: string,
  readdirImpl: ReaddirLike
): Promise<string[]> {
  const queue = [sessionRootPath];
  const files: string[] = [];

  while (queue.length > 0) {
    const currentPath = queue.pop();
    if (!currentPath) {
      continue;
    }

    let entries: Dirent[];
    try {
      entries = await readdirImpl(currentPath, {
        withFileTypes: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(entryPath);
      }
    }
  }

  files.sort((left, right) => right.localeCompare(left));
  return files;
}

export class CodexStatusService implements CodexStatusServiceLike {
  private readonly accountService: CodexAccountServiceLike;
  private readonly readFileImpl: ReadFileLike;
  private readonly readdirImpl: ReaddirLike;
  private readonly listSessionLogPathsImpl: ListSessionLogPathsLike;
  private readonly now: () => string;
  private readonly baseEnv: NodeJS.ProcessEnv;

  constructor(options: CodexStatusServiceOptions) {
    this.accountService = options.accountService;
    this.readFileImpl = options.readFile ?? defaultReadFile;
    this.readdirImpl = options.readdir ?? defaultReaddir;
    this.listSessionLogPathsImpl =
      options.listSessionLogPaths ??
      ((sessionRootPath) => defaultListSessionLogPaths(sessionRootPath, this.readdirImpl));
    this.now = options.now ?? (() => new Date().toISOString());
    this.baseEnv = options.baseEnv ?? process.env;
  }

  async getStatus(): Promise<CodexStatusRecord> {
    const fallbackHomePath = this.baseEnv.HOME ?? null;
    let accountState: CodexAccountRecord | null = null;
    const fallbackDiagnostics: CliVersionDiagnosticsRecord = {
      command: "codex",
      resolvedPath: null,
      installStatus: "error",
      installMethod: "unknown",
      currentVersion: null,
      rawVersionText: null,
      checkedAt: this.now(),
      latestVersion: null,
      latestStatus: "unknown",
      latestCheckedAt: null,
      latestSource: null,
      statusText: "CLI diagnostics are unavailable.",
    };

    try {
      accountState = await this.accountService.getState();
    } catch (error) {
      return emptyStatusRecord(
        {
          status: "error",
          statusText: error instanceof Error ? error.message : "Account state unavailable.",
          label: null,
          authMode: null,
          planType: null,
        },
        fallbackDiagnostics,
        null,
        null,
        "error",
        "Failed to load Codex account state."
      );
    }

    const account = summarizeAccount(accountState);
    const diagnostics = accountState.diagnostics;
    const homePath = accountState.homePath ?? fallbackHomePath;
    if (!homePath) {
      return emptyStatusRecord(
        account,
        diagnostics,
        null,
        null,
        "unavailable",
        "Codex home path is unavailable."
      );
    }

    let model: string | null = null;
    let reasoningEffort: string | null = null;
    try {
      const config = parseConfig(
        await this.readFileImpl(path.join(homePath, ".codex", "config.toml"), "utf8")
      );
      model = config.model;
      reasoningEffort = config.reasoningEffort;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return emptyStatusRecord(
          account,
          diagnostics,
          null,
          null,
          "error",
          "Failed to read Codex config."
        );
      }
    }

    let sessionLogPaths: string[];
    try {
      sessionLogPaths = await this.listSessionLogPathsImpl(
        path.join(homePath, ".codex", "sessions")
      );
    } catch {
      return emptyStatusRecord(
        account,
        diagnostics,
        model,
        reasoningEffort,
        "error",
        "Failed to read Codex session logs."
      );
    }

    let latestSnapshot: UsageSnapshot | null = null;
    for (const logPath of sessionLogPaths) {
      try {
        const candidate = parseUsageSnapshot(await this.readFileImpl(logPath, "utf8"));
        if (candidate && isNewerSnapshot(candidate, latestSnapshot)) {
          latestSnapshot = candidate;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          continue;
        }
        return emptyStatusRecord(
          account,
          diagnostics,
          model,
          reasoningEffort,
          "error",
          "Failed to parse Codex usage snapshot."
        );
      }

    }

    if (!latestSnapshot) {
      return emptyStatusRecord(
        account,
        diagnostics,
        model,
        reasoningEffort,
        "unavailable",
        "No Codex usage snapshot has been recorded yet."
      );
    }

    const freshState = freshnessState(latestSnapshot.refreshedAt, this.now());
    const fiveHour = withWindowState(
      latestSnapshot.fiveHour,
      FIVE_HOUR_WINDOW_MINUTES,
      freshState
    );
    const weekly = withWindowState(
      latestSnapshot.weekly,
      WEEKLY_WINDOW_MINUTES,
      freshState
    );
    const status = mergeStatus(freshState, fiveHour.status, weekly.status);

    return {
      provider: "codex",
      account,
      diagnostics,
      model,
      reasoningEffort,
      fiveHour,
      weekly,
      usageSummary: null,
      refreshedAt: latestSnapshot.refreshedAt,
      status,
      statusText:
        status === "stale"
          ? "Showing the latest stale Codex usage snapshot."
          : status === "unavailable"
            ? "Codex usage snapshot is unavailable."
            : "Codex usage snapshot is current.",
    };
  }
}
