export type ProviderKind = "codex" | "claude";

export type ProviderAccountStatus =
  | "authenticated"
  | "logged-out"
  | "pending"
  | "error"
  | "unavailable";

export type CliInstallStatus = "installed" | "not-installed" | "error";
export type CliInstallMethod = "homebrew-cask" | "npm-global" | "unknown";

export type CliLatestStatus =
  | "current"
  | "update-available"
  | "unknown"
  | "error";

export interface ProviderLoginMethodRecord {
  id: string;
  label: string;
  description: string;
  kind: "primary" | "advanced";
  hiddenByDefault: boolean;
  supported: boolean;
}

export interface ProviderAccountInfoRecord {
  label: string | null;
  email: string | null;
  name: string | null;
  userId: string | null;
  planType: string | null;
  organizationTitle: string | null;
  authMode: string | null;
}

export interface CliVersionDiagnosticsRecord {
  command: string;
  resolvedPath: string | null;
  installStatus: CliInstallStatus;
  installMethod: CliInstallMethod;
  currentVersion: string | null;
  rawVersionText: string | null;
  checkedAt: string;
  latestVersion: string | null;
  latestStatus: CliLatestStatus;
  latestCheckedAt: string | null;
  latestSource: string | null;
  statusText: string;
}

export interface CliUpdateRecord {
  status: "idle" | "pending" | "completed" | "failed";
  supported: boolean;
  installMethod: CliInstallMethod;
  commandPreview: string | null;
  startedAt: string | null;
  completedAt: string | null;
  output: string[];
  lastError: string | null;
}

export interface ProviderAccountRecord {
  provider: ProviderKind;
  providerLabel: string;
  status: ProviderAccountStatus;
  statusText: string;
  homePath: string | null;
  updatedAt: string;
  accountInfo: ProviderAccountInfoRecord;
  loginMethods: ProviderLoginMethodRecord[];
  primaryLoginMethodId: string | null;
  diagnostics: CliVersionDiagnosticsRecord;
  update: CliUpdateRecord;
}

export interface ProviderAccountServiceLike<
  TProviderRecord extends ProviderAccountRecord = ProviderAccountRecord,
> {
  getState(): Promise<TProviderRecord>;
}
