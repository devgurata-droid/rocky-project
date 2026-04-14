import { randomUUID } from "node:crypto";
import path from "node:path";
import { access, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

import {
  readJsonFile,
  serializeJson,
} from "../sessions/session-store.js";

import type { RuntimeAuthSource } from "../runtime/runtime-types.js";
import type {
  AuthProfileCreateInput,
  AuthProfilePaths,
  AuthProfileRecord,
  AuthProfileUpdateInput,
} from "./auth-profile-types.js";

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveAuthProfileStateRoot(stateRoot?: string): string {
  return path.resolve(
    stateRoot ?? path.join(process.cwd(), ".runtime", "agent-engine")
  );
}

export function resolveAuthProfilePaths({
  stateRoot,
  authProfileId,
}: {
  stateRoot?: string;
  authProfileId: string;
}): AuthProfilePaths {
  const resolvedStateRoot = resolveAuthProfileStateRoot(stateRoot);
  const profileRoot = path.join(resolvedStateRoot, "auth-profiles", authProfileId);
  const homePath = path.join(profileRoot, "home");
  const codexHomePath = path.join(homePath, ".codex");

  return {
    profileRoot,
    metadataPath: path.join(profileRoot, "profile.json"),
    homePath,
    codexHomePath,
    authConfigPath: path.join(codexHomePath, "auth.json"),
    runtimeConfigPath: path.join(codexHomePath, "config.toml"),
  };
}

function defaultLoginState() {
  return {
    status: "idle" as const,
    defaultMethod: "device-auth" as const,
    lastMethod: null,
    startedAt: null,
    completedAt: null,
    verificationUri: null,
    userCode: null,
    instructions: null,
    lastError: null,
  };
}

function hydrateAuthProfileRecord(
  persisted: Partial<AuthProfileRecord>,
  paths: AuthProfilePaths
): AuthProfileRecord {
  if (!persisted.id) {
    throw new Error("Persisted auth profile record is missing id");
  }

  if (!persisted.name) {
    throw new Error(`Persisted auth profile record is missing name: ${persisted.id}`);
  }

  const lifecycle = persisted.lifecycle === "archived" ? "archived" : "active";

  return {
    id: persisted.id,
    name: persisted.name,
    accountLabel: persisted.accountLabel ?? null,
    lifecycle,
    archivedAt:
      lifecycle === "archived"
        ? persisted.archivedAt ?? persisted.updatedAt ?? persisted.createdAt ?? null
        : null,
    homePath: path.resolve(persisted.homePath ?? paths.homePath),
    codexHomePath: path.resolve(persisted.codexHomePath ?? paths.codexHomePath),
    authConfigPath: path.resolve(
      persisted.authConfigPath ?? paths.authConfigPath
    ),
    runtimeConfigPath: path.resolve(
      persisted.runtimeConfigPath ?? paths.runtimeConfigPath
    ),
    login: {
      ...defaultLoginState(),
      ...(persisted.login ?? {}),
    },
    createdAt: persisted.createdAt ?? new Date(0).toISOString(),
    updatedAt: persisted.updatedAt ?? persisted.createdAt ?? new Date(0).toISOString(),
    lastUsedAt: persisted.lastUsedAt ?? null,
    lastVerifiedAt: persisted.lastVerifiedAt ?? null,
  };
}

export interface AuthProfileServiceOptions {
  stateRoot?: string;
  now?: () => string;
  idGenerator?: () => string;
}

export class AuthProfileService {
  private readonly stateRoot: string;
  private readonly now: () => string;
  private readonly idGenerator: () => string;

  constructor(options: AuthProfileServiceOptions = {}) {
    this.stateRoot = resolveAuthProfileStateRoot(options.stateRoot);
    this.now = options.now ?? (() => new Date().toISOString());
    this.idGenerator = options.idGenerator ?? randomUUID;
  }

  async createProfile(input: AuthProfileCreateInput): Promise<AuthProfileRecord> {
    if (!input.name?.trim()) {
      throw new Error("A non-empty auth profile name is required.");
    }

    const id = input.id?.trim() || this.idGenerator();
    const paths = resolveAuthProfilePaths({
      stateRoot: this.stateRoot,
      authProfileId: id,
    });

    if (await pathExists(paths.metadataPath)) {
      throw new Error(`Auth profile already exists: ${id}`);
    }

    const timestamp = this.now();
    const record: AuthProfileRecord = {
      id,
      name: input.name.trim(),
      accountLabel: input.accountLabel?.trim() || null,
      lifecycle: "active",
      archivedAt: null,
      homePath: paths.homePath,
      codexHomePath: paths.codexHomePath,
      authConfigPath: paths.authConfigPath,
      runtimeConfigPath: paths.runtimeConfigPath,
      login: defaultLoginState(),
      createdAt: timestamp,
      updatedAt: timestamp,
      lastUsedAt: null,
      lastVerifiedAt: null,
    };

    await mkdir(paths.codexHomePath, { recursive: true });
    await this.writeProfileRecord(paths, record);
    return record;
  }

  async listProfiles(
    options: { includeArchived?: boolean } = {}
  ): Promise<AuthProfileRecord[]> {
    const profilesRoot = path.join(this.stateRoot, "auth-profiles");
    if (!(await pathExists(profilesRoot))) {
      return [];
    }

    const entries = await readdir(profilesRoot, { withFileTypes: true });
    const profiles = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => this.getProfile(entry.name))
    );
    const visibleProfiles = options.includeArchived
      ? profiles
      : profiles.filter((profile) => profile.lifecycle !== "archived");

    return visibleProfiles.sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.createdAt.localeCompare(left.createdAt) ||
        left.id.localeCompare(right.id)
    );
  }

  async getProfile(authProfileId: string): Promise<AuthProfileRecord> {
    const paths = resolveAuthProfilePaths({
      stateRoot: this.stateRoot,
      authProfileId,
    });

    if (!(await pathExists(paths.metadataPath))) {
      throw new Error(`Unknown auth profile: ${authProfileId}`);
    }

    const persisted = await readJsonFile<Partial<AuthProfileRecord>>(paths.metadataPath);
    return hydrateAuthProfileRecord(persisted, paths);
  }

  async updateProfile(input: AuthProfileUpdateInput): Promise<AuthProfileRecord> {
    const profile = await this.getProfile(input.id);
    if (typeof input.name === "string") {
      const trimmed = input.name.trim();
      if (!trimmed) {
        throw new Error("Auth profile name must be a non-empty string.");
      }
      profile.name = trimmed;
    }

    if (Object.prototype.hasOwnProperty.call(input, "accountLabel")) {
      profile.accountLabel = input.accountLabel?.trim() || null;
    }

    if (input.lifecycle) {
      profile.lifecycle = input.lifecycle;
      profile.archivedAt =
        input.lifecycle === "archived" ? this.now() : null;
    }

    profile.updatedAt = this.now();
    const paths = resolveAuthProfilePaths({
      stateRoot: this.stateRoot,
      authProfileId: profile.id,
    });
    await this.writeProfileRecord(paths, profile);
    return profile;
  }

  async deleteProfile(authProfileId: string): Promise<void> {
    const paths = resolveAuthProfilePaths({
      stateRoot: this.stateRoot,
      authProfileId,
    });

    if (!(await pathExists(paths.profileRoot))) {
      throw new Error(`Unknown auth profile: ${authProfileId}`);
    }

    await rm(paths.profileRoot, {
      recursive: true,
      force: false,
    });
  }

  async markProfileUsed(authProfileId: string): Promise<AuthProfileRecord> {
    const profile = await this.getProfile(authProfileId);
    profile.lastUsedAt = this.now();
    profile.updatedAt = profile.lastUsedAt;
    const paths = resolveAuthProfilePaths({
      stateRoot: this.stateRoot,
      authProfileId,
    });
    await this.writeProfileRecord(paths, profile);
    return profile;
  }

  async resolveRuntimeAuthSource(
    authProfileId: string
  ): Promise<RuntimeAuthSource> {
    const profile = await this.getProfile(authProfileId);
    if (profile.lifecycle === "archived") {
      throw Object.assign(
        new Error(`Archived auth profiles are read-only: ${authProfileId}`),
        {
          statusCode: 409,
        }
      );
    }

    return {
      kind: "managed-home",
      authProfileId: profile.id,
      homePath: profile.homePath,
    };
  }

  private async writeProfileRecord(
    paths: AuthProfilePaths,
    profile: AuthProfileRecord
  ): Promise<void> {
    await mkdir(paths.profileRoot, { recursive: true });
    await mkdir(paths.codexHomePath, { recursive: true });
    await writeFile(paths.metadataPath, serializeJson(profile), "utf8");
  }
}
