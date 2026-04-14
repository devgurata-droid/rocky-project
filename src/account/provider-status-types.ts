import type {
  CliVersionDiagnosticsRecord,
  ProviderAccountStatus,
  ProviderKind,
} from "./provider-account-types.js";

export type ProviderStatusDataState = "ok" | "stale" | "unavailable" | "error";

export interface ProviderStatusAccountSummaryRecord {
  status: ProviderAccountStatus;
  statusText: string;
  label: string | null;
  authMode: string | null;
  planType: string | null;
}

export interface ProviderStatusUsageWindowRecord {
  status: ProviderStatusDataState;
  windowMinutes: number;
  usedPercent: number | null;
  remainingPercent: number | null;
  resetAt: string | null;
}

export interface ProviderUsageSummaryRecord {
  source: "rate-limits" | "stats-cache" | "session-log" | "none";
  totalTokens: number | null;
  totalCostUsd: number | null;
  totalMessages: number | null;
  totalSessions: number | null;
  primaryModel: string | null;
  refreshedAt: string | null;
}

export interface ProviderStatusRecord {
  provider: ProviderKind;
  account: ProviderStatusAccountSummaryRecord;
  diagnostics: CliVersionDiagnosticsRecord;
  model: string | null;
  reasoningEffort: string | null;
  fiveHour: ProviderStatusUsageWindowRecord;
  weekly: ProviderStatusUsageWindowRecord;
  usageSummary: ProviderUsageSummaryRecord | null;
  refreshedAt: string | null;
  status: ProviderStatusDataState;
  statusText: string;
}

export interface ProviderStatusServiceLike<
  TProviderStatus extends ProviderStatusRecord = ProviderStatusRecord,
> {
  getStatus(): Promise<TProviderStatus>;
}
