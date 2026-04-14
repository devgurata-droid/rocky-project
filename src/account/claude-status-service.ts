import { execFile as defaultExecFile } from "node:child_process";
import {
  mkdir as defaultMkdir,
  readdir as defaultReaddir,
  readFile as defaultReadFile,
  writeFile as defaultWriteFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { Dirent } from "node:fs";

import type { ClaudeAccountServiceLike } from "./claude-account-types.js";
import type { ClaudeStatusRecord, ClaudeStatusServiceLike } from "./claude-status-types.js";
import type {
  ProviderStatusAccountSummaryRecord,
  ProviderStatusDataState,
  ProviderStatusUsageWindowRecord,
  ProviderUsageSummaryRecord,
} from "./provider-status-types.js";

interface ClaudeStatusServiceOptions {
  accountService: ClaudeAccountServiceLike;
  readFile?: ReadFileLike;
  readdir?: ReaddirLike;
  listProjectLogPaths?: ListProjectLogPathsLike;
  listRunResultPaths?: ListRunResultPathsLike;
  readOauthAccessToken?: ReadOauthAccessTokenLike;
  fetch?: FetchLike;
  execFile?: ExecFileLike;
  writeFile?: WriteFileLike;
  mkdir?: MkdirLike;
  platform?: NodeJS.Platform;
  now?: () => string;
  baseEnv?: NodeJS.ProcessEnv;
  stateRoot?: string;
}

type ReadFileLike = (filePath: string, encoding: BufferEncoding) => Promise<string>;
type ReaddirLike = (
  directoryPath: string,
  options: { withFileTypes: true }
) => Promise<Dirent[]>;
type ListProjectLogPathsLike = (projectRootPath: string) => Promise<string[]>;
type ListRunResultPathsLike = (stateRootPath: string) => Promise<string[]>;
type ReadOauthAccessTokenLike = () => Promise<string | null>;
type FetchLike = (
  input: string | URL,
  init?: RequestInit
) => Promise<{
  headers: {
    get(name: string): string | null;
  };
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;
type ExecFileLike = (
  file: string,
  args: string[],
  options?: {
    env?: NodeJS.ProcessEnv;
  }
) => Promise<{
  stdout: string;
  stderr: string;
}>;
type WriteFileLike = (
  filePath: string,
  content: string,
  encoding: BufferEncoding
) => Promise<void>;
type MkdirLike = (
  directoryPath: string,
  options: {
    recursive: true;
  }
) => Promise<string | undefined>;

interface UsageWindowSnapshot {
  refreshedAt: string;
  windowMinutes: number;
  usedPercent: number | null;
  remainingPercent: number | null;
  resetAt: string | null;
}

interface RateLimitSnapshot {
  refreshedAt: string;
  fiveHour: UsageWindowSnapshot | null;
  weekly: UsageWindowSnapshot | null;
}

interface OauthUsageCacheRecord {
  snapshot: RateLimitSnapshot | null;
  nextAttemptAt: string | null;
}

const FIVE_HOUR_WINDOW_MINUTES = 300;
const WEEKLY_WINDOW_MINUTES = 10080;
const STALE_AFTER_MINUTES = 30;
const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";
const CLAUDE_OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_OAUTH_BETA_HEADER = "oauth-2025-04-20";
const OAUTH_USAGE_CACHE_MAX_AGE_MINUTES = 15;
const OAUTH_USAGE_RETRY_AFTER_FALLBACK_SECONDS = 300;
const DEFAULT_STATE_ROOT = path.resolve(
  process.cwd(),
  ".runtime",
  "agent-engine"
);
const execFileAsync = promisify(defaultExecFile);

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

function parseUtilizationPercent(value: unknown): number | null {
  const rawValue = readFiniteNumber(value);
  if (rawValue === null) {
    return null;
  }

  return clampPercent(rawValue <= 1 ? rawValue * 100 : rawValue);
}

function clampPercent(value: number | null): number | null {
  if (value === null) {
    return null;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
}

function addSeconds(isoTimestamp: string, seconds: number): string | null {
  const timestamp = new Date(isoTimestamp).getTime();
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return new Date(timestamp + seconds * 1000).toISOString();
}

function summarizeAccount(
  state: Awaited<ReturnType<ClaudeAccountServiceLike["getState"]>>
): ProviderStatusAccountSummaryRecord {
  return {
    status: state.status,
    statusText: state.statusText,
    label: state.accountInfo.label,
    authMode: state.accountInfo.authMode,
    planType: state.accountInfo.planType,
  };
}

function emptyWindow(
  windowMinutes: number,
  status: ProviderStatusDataState
): ProviderStatusUsageWindowRecord {
  return {
    status,
    windowMinutes,
    usedPercent: null,
    remainingPercent: null,
    resetAt: null,
  };
}

function withWindowState(
  snapshot: UsageWindowSnapshot | null,
  fallbackWindowMinutes: number,
  status: ProviderStatusDataState
): ProviderStatusUsageWindowRecord {
  if (!snapshot) {
    return emptyWindow(
      fallbackWindowMinutes,
      status === "error" ? "error" : "unavailable"
    );
  }

  return {
    status,
    windowMinutes: snapshot.windowMinutes,
    usedPercent: snapshot.usedPercent,
    remainingPercent: snapshot.remainingPercent,
    resetAt: snapshot.resetAt,
  };
}

function parseResetAt(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalizedValue = value >= 1_000_000_000_000 ? value : value * 1000;
    return new Date(normalizedValue).toISOString();
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  return null;
}

function parseWindowSnapshot(
  rawWindow: unknown,
  windowMinutes: number,
  refreshedAt: string
): UsageWindowSnapshot | null {
  if (!isRecord(rawWindow)) {
    return null;
  }

  const usedPercent = clampPercent(
    readFiniteNumber(rawWindow.used_percentage) ??
      readFiniteNumber(rawWindow.usedPercent) ??
      parseUtilizationPercent(rawWindow.utilization)
  );
  const resetAt = parseResetAt(
    rawWindow.resets_at ?? rawWindow.resetsAt ?? rawWindow.resetAt
  );

  return {
    refreshedAt,
    windowMinutes,
    usedPercent,
    remainingPercent: usedPercent === null ? null : clampPercent(100 - usedPercent),
    resetAt,
  };
}

function parseRateLimitSnapshot(logContent: string): RateLimitSnapshot | null {
  const lines = logContent.split(/\r?\n/);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }

    try {
      const parsed = JSON.parse(line);
      if (!isRecord(parsed)) {
        continue;
      }

      const rateLimits =
        (isRecord(parsed.rate_limits) ? parsed.rate_limits : null) ??
        (isRecord(parsed.rateLimits) ? parsed.rateLimits : null) ??
        (isRecord(parsed.payload) && isRecord(parsed.payload.rate_limits)
          ? parsed.payload.rate_limits
          : null) ??
        (isRecord(parsed.data) && isRecord(parsed.data.rate_limits)
          ? parsed.data.rate_limits
          : null) ??
        (isRecord(parsed.message) && isRecord(parsed.message.rate_limits)
          ? parsed.message.rate_limits
          : null);

      if (!rateLimits) {
        continue;
      }

      const refreshedAt =
        readNonEmptyString(parsed.timestamp) ??
        readNonEmptyString(parsed.updatedAt) ??
        readNonEmptyString(parsed.createdAt);
      if (!refreshedAt) {
        continue;
      }

      return {
        refreshedAt,
        fiveHour:
          parseWindowSnapshot(
            rateLimits.five_hour ?? rateLimits.fiveHour,
            FIVE_HOUR_WINDOW_MINUTES,
            refreshedAt
          ),
        weekly:
          parseWindowSnapshot(
            rateLimits.seven_day ?? rateLimits.sevenDay,
            WEEKLY_WINDOW_MINUTES,
            refreshedAt
          ),
      };
    } catch {
      continue;
    }
  }

  return null;
}

function isNewerSnapshot(
  candidate: RateLimitSnapshot,
  current: RateLimitSnapshot | null
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

function freshnessState(refreshedAt: string, now: string): ProviderStatusDataState {
  const refreshedTime = new Date(refreshedAt).getTime();
  const currentTime = new Date(now).getTime();
  if (Number.isNaN(refreshedTime) || Number.isNaN(currentTime)) {
    return "unavailable";
  }

  const ageMinutes = (currentTime - refreshedTime) / 60_000;
  return ageMinutes <= STALE_AFTER_MINUTES ? "ok" : "stale";
}

function shouldReuseOauthCache(refreshedAt: string, now: string): boolean {
  const refreshedTime = new Date(refreshedAt).getTime();
  const currentTime = new Date(now).getTime();
  if (Number.isNaN(refreshedTime) || Number.isNaN(currentTime)) {
    return false;
  }

  return (currentTime - refreshedTime) / 60_000 <= OAUTH_USAGE_CACHE_MAX_AGE_MINUTES;
}

function hasUsagePercent(window: ProviderStatusUsageWindowRecord): boolean {
  return window.remainingPercent !== null;
}

function mergeStatus(...states: ProviderStatusDataState[]): ProviderStatusDataState {
  const ranking: Record<ProviderStatusDataState, number> = {
    ok: 0,
    stale: 1,
    unavailable: 2,
    error: 3,
  };

  return states.reduce((current, next) =>
    ranking[next] > ranking[current] ? next : current
  );
}

function parseRuntimeRateLimitEvent(
  rawEvent: unknown,
  fallbackRefreshedAt: string | null
): {
  kind: "fiveHour" | "weekly";
  snapshot: UsageWindowSnapshot;
} | null {
  if (!isRecord(rawEvent)) {
    return null;
  }

  const parsed =
    rawEvent.type === "rate_limit_event"
      ? rawEvent
      : rawEvent.rawType === "rate_limit_event" && isRecord(rawEvent.raw)
        ? rawEvent.raw
        : null;
  if (!parsed || !isRecord(parsed.rate_limit_info)) {
    return null;
  }

  const info = parsed.rate_limit_info;
  const rateLimitType = readNonEmptyString(info.rateLimitType ?? info.rate_limit_type);
  if (!rateLimitType) {
    return null;
  }

  const refreshedAt =
    readNonEmptyString(parsed.timestamp) ??
    readNonEmptyString((rawEvent as Record<string, unknown>).occurredAt) ??
    fallbackRefreshedAt;
  if (!refreshedAt) {
    return null;
  }

  const usedPercent = parseUtilizationPercent(info.utilization);
  const snapshot: UsageWindowSnapshot = {
    refreshedAt,
    windowMinutes:
      rateLimitType === "five_hour"
        ? FIVE_HOUR_WINDOW_MINUTES
        : WEEKLY_WINDOW_MINUTES,
    usedPercent,
    remainingPercent: usedPercent === null ? null : clampPercent(100 - usedPercent),
    resetAt: parseResetAt(info.resetsAt ?? info.resets_at),
  };

  if (rateLimitType === "five_hour") {
    return {
      kind: "fiveHour",
      snapshot,
    };
  }

  if (
    rateLimitType === "seven_day" ||
    rateLimitType === "seven_day_sonnet" ||
    rateLimitType === "seven_day_opus"
  ) {
    return {
      kind: "weekly",
      snapshot,
    };
  }

  return null;
}

function mergeWindowSnapshot(
  current: UsageWindowSnapshot | null,
  candidate: UsageWindowSnapshot
): UsageWindowSnapshot {
  if (!current) {
    return candidate;
  }

  const candidateTime = new Date(candidate.refreshedAt).getTime();
  const currentTime = new Date(current.refreshedAt).getTime();
  if (Number.isNaN(candidateTime)) {
    return current;
  }

  if (Number.isNaN(currentTime) || candidateTime > currentTime) {
    return candidate;
  }

  return current;
}

function parseRuntimeResultRateLimitSnapshot(content: string): RateLimitSnapshot | null {
  try {
    const parsed = JSON.parse(content);
    if (!isRecord(parsed) || !Array.isArray(parsed.rawEvents)) {
      return null;
    }

    const fallbackRefreshedAt =
      readNonEmptyString(parsed.endedAt) ??
      readNonEmptyString(parsed.startedAt) ??
      readNonEmptyString(parsed.refreshedAt);
    let fiveHour: UsageWindowSnapshot | null = null;
    let weekly: UsageWindowSnapshot | null = null;

    for (const rawEvent of parsed.rawEvents) {
      const event = parseRuntimeRateLimitEvent(rawEvent, fallbackRefreshedAt);
      if (!event) {
        continue;
      }

      if (event.kind === "fiveHour") {
        fiveHour = mergeWindowSnapshot(fiveHour, event.snapshot);
        continue;
      }

      weekly = mergeWindowSnapshot(weekly, event.snapshot);
    }

    if (!fiveHour && !weekly) {
      return null;
    }

    const refreshedAt = [fiveHour?.refreshedAt, weekly?.refreshedAt]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);

    return refreshedAt
      ? {
          refreshedAt,
          fiveHour,
          weekly,
        }
      : null;
  } catch {
    return null;
  }
}

function sumModelTokens(usage: Record<string, unknown>): {
  totalTokens: number | null;
  totalCostUsd: number | null;
  primaryModel: string | null;
} {
  let totalTokens = 0;
  let totalCostUsd = 0;
  let primaryModel: string | null = null;
  let primaryModelTokens = -1;

  for (const [model, rawStats] of Object.entries(usage)) {
    if (!isRecord(rawStats)) {
      continue;
    }

    const modelTokens =
      (readFiniteNumber(rawStats.inputTokens) ?? 0) +
      (readFiniteNumber(rawStats.outputTokens) ?? 0) +
      (readFiniteNumber(rawStats.cacheReadInputTokens) ?? 0) +
      (readFiniteNumber(rawStats.cacheCreationInputTokens) ?? 0);
    const costUsd = readFiniteNumber(rawStats.costUSD) ?? 0;

    totalTokens += modelTokens;
    totalCostUsd += costUsd;

    if (modelTokens > primaryModelTokens) {
      primaryModelTokens = modelTokens;
      primaryModel = model;
    }
  }

  return {
    totalTokens: totalTokens > 0 ? totalTokens : null,
    totalCostUsd: totalCostUsd > 0 ? totalCostUsd : null,
    primaryModel,
  };
}

function parseStatsCache(content: string): ProviderUsageSummaryRecord | null {
  try {
    const parsed = JSON.parse(content);
    if (!isRecord(parsed)) {
      return null;
    }

    const usage = isRecord(parsed.modelUsage) ? parsed.modelUsage : null;
    const totals = usage ? sumModelTokens(usage) : {
      totalTokens: null,
      totalCostUsd: null,
      primaryModel: null,
    };
    const lastComputedDate = readNonEmptyString(parsed.lastComputedDate);

    return {
      source: "stats-cache",
      totalTokens: totals.totalTokens,
      totalCostUsd: totals.totalCostUsd,
      totalMessages: readFiniteNumber(parsed.totalMessages),
      totalSessions: readFiniteNumber(parsed.totalSessions),
      primaryModel: totals.primaryModel,
      refreshedAt:
        lastComputedDate ? new Date(`${lastComputedDate}T00:00:00.000Z`).toISOString() : null,
    };
  } catch {
    return null;
  }
}

function parseClaudeOauthAccessToken(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const claudeAiOauth = isRecord(value.claudeAiOauth) ? value.claudeAiOauth : null;
  if (!claudeAiOauth) {
    return null;
  }

  return readNonEmptyString(claudeAiOauth.accessToken);
}

function parseOauthUsageSnapshot(
  payload: unknown,
  refreshedAt: string
): RateLimitSnapshot | null {
  if (!isRecord(payload)) {
    return null;
  }

  const fiveHour = parseWindowSnapshot(
    payload.five_hour ?? payload.fiveHour,
    FIVE_HOUR_WINDOW_MINUTES,
    refreshedAt
  );
  const weekly = parseWindowSnapshot(
    payload.seven_day ?? payload.sevenDay,
    WEEKLY_WINDOW_MINUTES,
    refreshedAt
  );

  if (!fiveHour && !weekly) {
    return null;
  }

  return {
    refreshedAt,
    fiveHour,
    weekly,
  };
}

function parseOauthUsageCache(content: string): OauthUsageCacheRecord | null {
  try {
    const parsed = JSON.parse(content);
    if (!isRecord(parsed)) {
      return null;
    }

    const refreshedAt = readNonEmptyString(parsed.refreshedAt);
    const snapshot =
      refreshedAt
        ? parseOauthUsageSnapshot(
            {
              five_hour: parsed.fiveHour,
              seven_day: parsed.weekly,
            },
            refreshedAt
          )
        : null;

    return {
      snapshot,
      nextAttemptAt: readNonEmptyString(parsed.nextAttemptAt),
    };
  } catch {
    return null;
  }
}

function formatOauthUsageCache(cache: OauthUsageCacheRecord): string {
  return JSON.stringify(
    {
      refreshedAt: cache.snapshot?.refreshedAt ?? null,
      nextAttemptAt: cache.nextAttemptAt,
      fiveHour: cache.snapshot?.fiveHour ?? null,
      weekly: cache.snapshot?.weekly ?? null,
    },
    null,
    2
  );
}

function parseRetryAfterHeader(value: string | null, now: string): string | null {
  if (!value) {
    return addSeconds(now, OAUTH_USAGE_RETRY_AFTER_FALLBACK_SECONDS);
  }

  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds)) {
    return addSeconds(now, seconds);
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? addSeconds(now, OAUTH_USAGE_RETRY_AFTER_FALLBACK_SECONDS) : parsedDate.toISOString();
}

async function listProjectLogPaths(
  projectRootPath: string,
  readdirImpl: ReaddirLike
): Promise<string[]> {
  const entries = await readdirImpl(projectRootPath, {
    withFileTypes: true,
  });

  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(projectRootPath, entry.name);
      if (entry.isDirectory()) {
        return await listProjectLogPaths(absolutePath, readdirImpl);
      }

      return entry.isFile() && absolutePath.endsWith(".jsonl")
        ? [absolutePath]
        : [];
    })
  );

  return nested.flat();
}

async function listRunResultPaths(
  rootPath: string,
  readdirImpl: ReaddirLike
): Promise<string[]> {
  const entries = await readdirImpl(rootPath, {
    withFileTypes: true,
  });

  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(rootPath, entry.name);
      if (entry.isDirectory()) {
        return await listRunResultPaths(absolutePath, readdirImpl);
      }

      return entry.isFile() && entry.name === "result.json"
        ? [absolutePath]
        : [];
    })
  );

  return nested.flat();
}

export class ClaudeStatusService implements ClaudeStatusServiceLike {
  private readonly accountService: ClaudeAccountServiceLike;
  private readonly readFileImpl: ReadFileLike;
  private readonly readdirImpl: ReaddirLike;
  private readonly listProjectLogPathsImpl: ListProjectLogPathsLike;
  private readonly listRunResultPathsImpl: ListRunResultPathsLike;
  private readonly readOauthAccessTokenImpl: ReadOauthAccessTokenLike;
  private readonly fetchImpl: FetchLike;
  private readonly execFileImpl: ExecFileLike;
  private readonly writeFileImpl: WriteFileLike;
  private readonly mkdirImpl: MkdirLike;
  private readonly platform: NodeJS.Platform;
  private readonly now: () => string;
  private readonly baseEnv: NodeJS.ProcessEnv;
  private readonly stateRoot: string;

  constructor(options: ClaudeStatusServiceOptions) {
    this.accountService = options.accountService;
    this.readFileImpl =
      options.readFile ??
      ((filePath, encoding) => defaultReadFile(filePath, { encoding }));
    this.readdirImpl = options.readdir ?? defaultReaddir;
    this.listProjectLogPathsImpl =
      options.listProjectLogPaths ??
      (async (projectRootPath) => await listProjectLogPaths(projectRootPath, this.readdirImpl));
    this.listRunResultPathsImpl =
      options.listRunResultPaths ??
      (async (stateRootPath) => await listRunResultPaths(stateRootPath, this.readdirImpl));
    this.readOauthAccessTokenImpl =
      options.readOauthAccessToken ??
      (async () => await this.readOauthAccessToken());
    this.fetchImpl =
      options.fetch ??
      (async (input, init) => await fetch(input, init));
    this.execFileImpl =
      options.execFile ??
      (async (file, args, execOptions) =>
        await execFileAsync(file, args, {
          env: execOptions?.env,
          encoding: "utf8",
        }));
    this.writeFileImpl =
      options.writeFile ??
      (async (filePath, content, encoding) =>
        await defaultWriteFile(filePath, content, { encoding }));
    this.mkdirImpl =
      options.mkdir ??
      (async (directoryPath, mkdirOptions) =>
        await defaultMkdir(directoryPath, mkdirOptions));
    this.platform = options.platform ?? process.platform;
    this.now = options.now ?? (() => new Date().toISOString());
    this.baseEnv = options.baseEnv ?? process.env;
    this.stateRoot = path.resolve(options.stateRoot ?? DEFAULT_STATE_ROOT);
  }

  async getStatus(): Promise<ClaudeStatusRecord> {
    const state = await this.accountService.getState();
    const usageSummary = await this.readUsageSummary();
    const oauthRateLimitSnapshot = await this.readOauthRateLimitSnapshot(state);
    const fallbackRateLimitSnapshot = [await this.readLatestProjectRateLimitSnapshot(), await this.readLatestRuntimeRateLimitSnapshot()].reduce<RateLimitSnapshot | null>(
      (latest, candidate) =>
        candidate && isNewerSnapshot(candidate, latest) ? candidate : latest,
      null
    );
    const rateLimitSnapshot = oauthRateLimitSnapshot ?? fallbackRateLimitSnapshot;

    if (state.diagnostics.installStatus !== "installed") {
      return {
        provider: "claude",
        account: summarizeAccount(state),
        diagnostics: state.diagnostics,
        model: null,
        reasoningEffort: null,
        fiveHour: emptyWindow(FIVE_HOUR_WINDOW_MINUTES, "unavailable"),
        weekly: emptyWindow(WEEKLY_WINDOW_MINUTES, "unavailable"),
        usageSummary,
        refreshedAt: usageSummary?.refreshedAt ?? null,
        status: "unavailable",
        statusText: "Claude Code CLI is unavailable.",
      };
    }

    if (rateLimitSnapshot) {
      const currentTime = this.now();
      const fiveHour = withWindowState(
        rateLimitSnapshot.fiveHour,
        FIVE_HOUR_WINDOW_MINUTES,
        rateLimitSnapshot.fiveHour
          ? freshnessState(rateLimitSnapshot.fiveHour.refreshedAt, currentTime)
          : "unavailable"
      );
      const weekly = withWindowState(
        rateLimitSnapshot.weekly,
        WEEKLY_WINDOW_MINUTES,
        rateLimitSnapshot.weekly
          ? freshnessState(rateLimitSnapshot.weekly.refreshedAt, currentTime)
          : "unavailable"
      );
      const windows = [fiveHour, weekly];
      const availableStates = windows
        .filter(hasUsagePercent)
        .map((window) => window.status);
      const hasResetMetadataOnly =
        availableStates.length === 0 &&
        windows.some((window) => window.remainingPercent === null && window.resetAt !== null);
      const status = hasResetMetadataOnly
        ? "unavailable"
        : availableStates.length > 0
          ? mergeStatus(...availableStates)
          : mergeStatus(fiveHour.status, weekly.status);
      const statusText = hasResetMetadataOnly
        ? "Claude Code emitted reset metadata, but this CLI version did not expose usage percentages in non-interactive mode."
        : oauthRateLimitSnapshot
          ? "Claude usage loaded from OAuth usage API."
        : status === "stale"
          ? "Claude rate-limit snapshot is stale."
          : "Claude rate-limit snapshot is current.";
      return {
        provider: "claude",
        account: summarizeAccount(state),
        diagnostics: state.diagnostics,
        model: usageSummary?.primaryModel ?? null,
        reasoningEffort: null,
        fiveHour,
        weekly,
        usageSummary,
        refreshedAt: rateLimitSnapshot.refreshedAt,
        status,
        statusText,
      };
    }

    if (usageSummary) {
      return {
        provider: "claude",
        account: summarizeAccount(state),
        diagnostics: state.diagnostics,
        model: usageSummary.primaryModel,
        reasoningEffort: null,
        fiveHour: emptyWindow(FIVE_HOUR_WINDOW_MINUTES, "unavailable"),
        weekly: emptyWindow(WEEKLY_WINDOW_MINUTES, "unavailable"),
        usageSummary,
        refreshedAt: usageSummary.refreshedAt,
        status: "ok",
        statusText: "Claude usage summary loaded from local stats cache.",
      };
    }

    return {
      provider: "claude",
      account: summarizeAccount(state),
      diagnostics: state.diagnostics,
      model: null,
      reasoningEffort: null,
      fiveHour: emptyWindow(FIVE_HOUR_WINDOW_MINUTES, "unavailable"),
      weekly: emptyWindow(WEEKLY_WINDOW_MINUTES, "unavailable"),
      usageSummary: null,
      refreshedAt: null,
      status: "unavailable",
      statusText: "Claude Code usage telemetry is not available yet.",
    };
  }

  private async readUsageSummary(): Promise<ProviderUsageSummaryRecord | null> {
    const homePath = this.baseEnv.HOME;
    if (!homePath) {
      return null;
    }

    try {
      const content = await this.readFileImpl(
        path.join(homePath, ".claude", "stats-cache.json"),
        "utf8"
      );
      return parseStatsCache(content);
    } catch {
      return null;
    }
  }

  private async readOauthRateLimitSnapshot(
    state: Awaited<ReturnType<ClaudeAccountServiceLike["getState"]>>
  ): Promise<RateLimitSnapshot | null> {
    const currentTime = this.now();
    const cached = await this.readCachedOauthRateLimitSnapshot();
    if (cached?.snapshot && shouldReuseOauthCache(cached.snapshot.refreshedAt, currentTime)) {
      return cached.snapshot;
    }
    if (cached?.nextAttemptAt) {
      const nextAttemptTime = new Date(cached.nextAttemptAt).getTime();
      const currentTimestamp = new Date(currentTime).getTime();
      if (!Number.isNaN(nextAttemptTime) && !Number.isNaN(currentTimestamp) && nextAttemptTime > currentTimestamp) {
        return cached.snapshot;
      }
    }

    if (state.status !== "authenticated" || state.apiProvider !== "firstParty") {
      return cached?.snapshot ?? null;
    }

    const accessToken = await this.readOauthAccessTokenImpl();
    if (!accessToken) {
      return cached?.snapshot ?? null;
    }

    try {
      const response = await this.fetchImpl(CLAUDE_OAUTH_USAGE_URL, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "anthropic-beta": CLAUDE_OAUTH_BETA_HEADER,
          "User-Agent": state.diagnostics.currentVersion
            ? `claude-code/${state.diagnostics.currentVersion}`
            : "claude-code",
        },
      });
      if (!response.ok) {
        if (response.status === 429) {
          await this.writeCachedOauthRateLimitSnapshot({
            snapshot: cached?.snapshot ?? null,
            nextAttemptAt: parseRetryAfterHeader(
              response.headers.get("retry-after"),
              currentTime
            ),
          });
        }
        return cached?.snapshot ?? null;
      }

      const snapshot = parseOauthUsageSnapshot(await response.json(), currentTime);
      if (snapshot) {
        await this.writeCachedOauthRateLimitSnapshot({
          snapshot,
          nextAttemptAt: null,
        });
        return snapshot;
      }

      return cached?.snapshot ?? null;
    } catch {
      return cached?.snapshot ?? null;
    }
  }

  private async readOauthAccessToken(): Promise<string | null> {
    const envToken = readNonEmptyString(this.baseEnv.CLAUDE_CODE_SESSION_ACCESS_TOKEN);
    if (envToken) {
      return envToken;
    }

    const homePath = this.baseEnv.HOME;
    if (!homePath) {
      return null;
    }

    try {
      const credentialsContent = await this.readFileImpl(
        path.join(homePath, ".claude", ".credentials.json"),
        "utf8"
      );
      const parsed = JSON.parse(credentialsContent);
      const fileToken = parseClaudeOauthAccessToken(parsed);
      if (fileToken) {
        return fileToken;
      }
    } catch {
      // Fall back to platform-secure storage.
    }

    if (this.platform !== "darwin") {
      return null;
    }

    try {
      const { stdout } = await this.execFileImpl(
        "security",
        ["find-generic-password", "-s", CLAUDE_KEYCHAIN_SERVICE, "-w"],
        {
          env: this.baseEnv,
        }
      );
      const parsed = JSON.parse(stdout);
      return parseClaudeOauthAccessToken(parsed);
    } catch {
      return null;
    }
  }

  private oauthUsageCachePath(): string {
    return path.join(this.stateRoot, "account", "claude-oauth-usage.json");
  }

  private async readCachedOauthRateLimitSnapshot(): Promise<OauthUsageCacheRecord | null> {
    try {
      const content = await this.readFileImpl(this.oauthUsageCachePath(), "utf8");
      return parseOauthUsageCache(content);
    } catch {
      return null;
    }
  }

  private async writeCachedOauthRateLimitSnapshot(
    cache: OauthUsageCacheRecord
  ): Promise<void> {
    const cachePath = this.oauthUsageCachePath();
    await this.mkdirImpl(path.dirname(cachePath), { recursive: true });
    await this.writeFileImpl(cachePath, formatOauthUsageCache(cache), "utf8");
  }

  private async readLatestProjectRateLimitSnapshot(): Promise<RateLimitSnapshot | null> {
    const homePath = this.baseEnv.HOME;
    if (!homePath) {
      return null;
    }

    const projectRootPath = path.join(homePath, ".claude", "projects");
    let logPaths: string[] = [];
    try {
      logPaths = await this.listProjectLogPathsImpl(projectRootPath);
    } catch {
      return null;
    }

    let latestSnapshot: RateLimitSnapshot | null = null;
    for (const logPath of logPaths) {
      try {
        const content = await this.readFileImpl(logPath, "utf8");
        const snapshot = parseRateLimitSnapshot(content);
        if (snapshot && isNewerSnapshot(snapshot, latestSnapshot)) {
          latestSnapshot = snapshot;
        }
      } catch {
        continue;
      }
    }

    return latestSnapshot;
  }

  private async readLatestRuntimeRateLimitSnapshot(): Promise<RateLimitSnapshot | null> {
    let resultPaths: string[] = [];
    try {
      resultPaths = await this.listRunResultPathsImpl(this.stateRoot);
    } catch {
      return null;
    }

    let latestSnapshot: RateLimitSnapshot | null = null;
    for (const resultPath of resultPaths) {
      try {
        const content = await this.readFileImpl(resultPath, "utf8");
        const snapshot = parseRuntimeResultRateLimitSnapshot(content);
        if (snapshot && isNewerSnapshot(snapshot, latestSnapshot)) {
          latestSnapshot = snapshot;
        }
      } catch {
        continue;
      }
    }

    return latestSnapshot;
  }
}
