import type { RuntimeAuthSource } from "../runtime/runtime-types.js";

export type AuthProfileLifecycle = "active" | "archived";
export type AuthProfileLoginStatus =
  | "idle"
  | "pending"
  | "authenticated"
  | "failed";
export type AuthProfileLoginMethod = "device-auth" | "api-key" | null;

export interface AuthProfileLoginState {
  status: AuthProfileLoginStatus;
  defaultMethod: "device-auth";
  lastMethod: AuthProfileLoginMethod;
  startedAt: string | null;
  completedAt: string | null;
  verificationUri: string | null;
  userCode: string | null;
  instructions: string | null;
  lastError: string | null;
}

export interface AuthProfileRecord {
  id: string;
  name: string;
  accountLabel: string | null;
  lifecycle: AuthProfileLifecycle;
  archivedAt: string | null;
  homePath: string;
  codexHomePath: string;
  authConfigPath: string;
  runtimeConfigPath: string;
  login: AuthProfileLoginState;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  lastVerifiedAt: string | null;
}

export interface AuthProfileCreateInput {
  id?: string;
  name: string;
  accountLabel?: string | null;
}

export interface AuthProfileUpdateInput {
  id: string;
  name?: string;
  accountLabel?: string | null;
  lifecycle?: AuthProfileLifecycle;
}

export interface AuthProfileServiceLike {
  createProfile(input: AuthProfileCreateInput): Promise<AuthProfileRecord>;
  listProfiles(options?: {
    includeArchived?: boolean;
  }): Promise<AuthProfileRecord[]>;
  getProfile(authProfileId: string): Promise<AuthProfileRecord>;
  updateProfile(input: AuthProfileUpdateInput): Promise<AuthProfileRecord>;
  deleteProfile(authProfileId: string): Promise<void>;
  markProfileUsed(authProfileId: string): Promise<AuthProfileRecord>;
  resolveRuntimeAuthSource(
    authProfileId: string
  ): Promise<RuntimeAuthSource>;
}

export interface AuthProfilePaths {
  profileRoot: string;
  metadataPath: string;
  homePath: string;
  codexHomePath: string;
  authConfigPath: string;
  runtimeConfigPath: string;
}
