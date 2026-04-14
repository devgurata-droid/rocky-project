import type {
  ProviderStatusAccountSummaryRecord,
  ProviderStatusDataState,
  ProviderStatusRecord,
  ProviderStatusServiceLike,
  ProviderStatusUsageWindowRecord,
} from "./provider-status-types.js";

export type CodexStatusDataState = ProviderStatusDataState;

export type CodexStatusAccountSummaryRecord = ProviderStatusAccountSummaryRecord;

export type CodexStatusUsageWindowRecord = ProviderStatusUsageWindowRecord;

export interface CodexStatusRecord
  extends Omit<ProviderStatusRecord, "provider"> {
  provider: "codex";
}

export interface CodexStatusServiceLike
  extends ProviderStatusServiceLike<CodexStatusRecord> {
  getStatus(): Promise<CodexStatusRecord>;
}
