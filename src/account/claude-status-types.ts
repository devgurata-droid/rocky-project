import type {
  ProviderStatusRecord,
  ProviderStatusServiceLike,
} from "./provider-status-types.js";

export interface ClaudeStatusRecord
  extends Omit<ProviderStatusRecord, "provider"> {
  provider: "claude";
}

export interface ClaudeStatusServiceLike
  extends ProviderStatusServiceLike<ClaudeStatusRecord> {
  getStatus(): Promise<ClaudeStatusRecord>;
}
