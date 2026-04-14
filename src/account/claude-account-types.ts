import type {
  ProviderAccountRecord,
  ProviderAccountServiceLike,
} from "./provider-account-types.js";

export interface ClaudeBrowserAuthRecord {
  status: "idle" | "pending" | "completed" | "failed";
  mode: "claudeai" | "console" | null;
  startedAt: string | null;
  completedAt: string | null;
  verificationUri: string | null;
  instructions: string | null;
  lastError: string | null;
}

export interface ClaudeAccountRecord
  extends Omit<ProviderAccountRecord, "provider" | "providerLabel"> {
  provider: "claude";
  providerLabel: "Claude Code";
  claudeBin: string;
  apiProvider: string | null;
  browserAuth: ClaudeBrowserAuthRecord;
}

export interface ClaudeAccountServiceLike
  extends ProviderAccountServiceLike<ClaudeAccountRecord> {
  getState(): Promise<ClaudeAccountRecord>;
  startBrowserLogin(mode?: "claudeai" | "console"): Promise<ClaudeAccountRecord>;
  startUpdate(): Promise<ClaudeAccountRecord>;
  logout(): Promise<ClaudeAccountRecord>;
}
