import { spawn as defaultSpawn } from "node:child_process";

import type { SpawnLike } from "../runtime/runtime-types.js";
import { CliDiagnosticsService } from "./cli-diagnostics-service.js";
import {
  createCliUpdateRecord,
  resolveCliUpdatePlan,
} from "./cli-update-service.js";
import type { ClaudeAccountRecord, ClaudeAccountServiceLike } from "./claude-account-types.js";
import type {
  ProviderAccountInfoRecord,
  ProviderLoginMethodRecord,
} from "./provider-account-types.js";
import type { LatestVersionResolverLike } from "./cli-diagnostics-service.js";

interface ClaudeAccountServiceOptions {
  spawn?: SpawnLike;
  now?: () => string;
  baseEnv?: NodeJS.ProcessEnv;
  claudeBin?: string;
  latestVersionResolver?: LatestVersionResolverLike;
}

interface CommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

const LOGIN_URL_PATTERN = /https?:\/\/\S+/i;

function emptyAccountInfoState(): ProviderAccountInfoRecord {
  return {
    label: null,
    email: null,
    name: null,
    userId: null,
    planType: null,
    organizationTitle: null,
    authMode: null,
  };
}

function emptyBrowserAuthState(): ClaudeAccountRecord["browserAuth"] {
  return {
    status: "idle",
    mode: null,
    startedAt: null,
    completedAt: null,
    verificationUri: null,
    instructions: null,
    lastError: null,
  };
}

function claudeLoginMethods(): ProviderLoginMethodRecord[] {
  return [
    {
      id: "browser-login",
      label: "Claude 로그인",
      description: "Primary Claude subscription login flow.",
      kind: "primary",
      hiddenByDefault: false,
      supported: true,
    },
    {
      id: "console-login",
      label: "Console login",
      description: "Advanced Anthropic Console login flow.",
      kind: "advanced",
      hiddenByDefault: true,
      supported: true,
    },
  ];
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseClaudeAuthOutput(rawOutput: string): {
  status: ClaudeAccountRecord["status"];
  statusText: string;
  accountInfo: ProviderAccountInfoRecord;
  apiProvider: string | null;
} {
  const normalizedOutput = rawOutput.trim();
  if (!normalizedOutput) {
    return {
      status: "unavailable",
      statusText: "Claude auth status is unavailable.",
      accountInfo: emptyAccountInfoState(),
      apiProvider: null,
    };
  }

  try {
    const parsed = JSON.parse(normalizedOutput);
    if (!isRecord(parsed)) {
      throw new Error("Not a JSON object");
    }

    const loggedIn = parsed.loggedIn === true;
    const authMode = readNonEmptyString(parsed.authMethod);
    const apiProvider = readNonEmptyString(parsed.apiProvider);
    const email =
      readNonEmptyString(parsed.email) ??
      readNonEmptyString(parsed.accountEmail) ??
      readNonEmptyString(parsed.userEmail);
    const name =
      readNonEmptyString(parsed.name) ??
      readNonEmptyString(parsed.accountName);
    const userId =
      readNonEmptyString(parsed.userId) ??
      readNonEmptyString(parsed.accountId) ??
      readNonEmptyString(parsed.login);
    const organizationTitle =
      readNonEmptyString(parsed.organizationTitle) ??
      readNonEmptyString(parsed.organizationName);

    return {
      status: loggedIn ? "authenticated" : "logged-out",
      statusText: loggedIn
        ? "Claude Code is authenticated."
        : "Claude Code is not logged in.",
      accountInfo: {
        label: email ?? name ?? userId ?? apiProvider ?? null,
        email,
        name,
        userId,
        planType: null,
        organizationTitle,
        authMode,
      },
      apiProvider,
    };
  } catch {
    return {
      status: /logged.?in/i.test(normalizedOutput) ? "authenticated" : "error",
      statusText: normalizedOutput,
      accountInfo: emptyAccountInfoState(),
      apiProvider: null,
    };
  }
}

function buildInitialState(
  now: string,
  homePath: string | null,
  claudeBin: string
): ClaudeAccountRecord {
  const diagnostics: ClaudeAccountRecord["diagnostics"] = {
    command: claudeBin,
    resolvedPath: null,
    installStatus: "not-installed",
    installMethod: "unknown",
    currentVersion: null,
    rawVersionText: null,
    checkedAt: now,
    latestVersion: null,
    latestStatus: "unknown",
    latestCheckedAt: null,
    latestSource: null,
    statusText: "CLI diagnostics have not been checked yet.",
  };

  return {
    provider: "claude",
    providerLabel: "Claude Code",
    status: "logged-out",
    statusText: "Claude Code is not logged in.",
    homePath,
    updatedAt: now,
    claudeBin,
    accountInfo: emptyAccountInfoState(),
    apiProvider: null,
    loginMethods: claudeLoginMethods(),
    primaryLoginMethodId: "browser-login",
    diagnostics,
    update: createCliUpdateRecord("claude", diagnostics),
    browserAuth: emptyBrowserAuthState(),
  };
}

export class ClaudeAccountService implements ClaudeAccountServiceLike {
  private readonly spawnImpl: SpawnLike;
  private readonly now: () => string;
  private readonly baseEnv: NodeJS.ProcessEnv;
  private readonly claudeBin: string;
  private readonly diagnosticsService: CliDiagnosticsService;
  private state: ClaudeAccountRecord;
  private activeLogin:
    | {
        child: ReturnType<SpawnLike>;
      }
    | null = null;
  private activeUpdate:
    | {
        child: ReturnType<SpawnLike>;
      }
    | null = null;

  constructor(options: ClaudeAccountServiceOptions = {}) {
    this.spawnImpl = options.spawn ?? (defaultSpawn as unknown as SpawnLike);
    this.now = options.now ?? (() => new Date().toISOString());
    this.baseEnv = options.baseEnv ?? process.env;
    this.claudeBin = options.claudeBin ?? "claude";
    this.diagnosticsService = new CliDiagnosticsService({
      provider: "claude",
      command: this.claudeBin,
      spawn: this.spawnImpl,
      now: this.now,
      baseEnv: this.baseEnv,
      latestVersionResolver: options.latestVersionResolver,
    });
    this.state = buildInitialState(this.now(), this.baseEnv.HOME ?? null, this.claudeBin);
  }

  async getState(): Promise<ClaudeAccountRecord> {
    if (this.activeLogin || this.activeUpdate) {
      return this.snapshot();
    }

    return this.refreshStatus();
  }

  async startBrowserLogin(
    mode: "claudeai" | "console" = "claudeai"
  ): Promise<ClaudeAccountRecord> {
    if (this.activeLogin) {
      return this.snapshot();
    }
    if (this.activeUpdate) {
      throw new Error("Claude Code update is in progress.");
    }

    const current = await this.refreshStatus();
    if (current.status === "authenticated") {
      return current;
    }

    const startedAt = this.now();
    this.state = {
      ...this.state,
      status: "pending",
      statusText: "Claude login in progress.",
      updatedAt: startedAt,
      browserAuth: {
        ...emptyBrowserAuthState(),
        status: "pending",
        mode,
        startedAt,
        instructions: "Open the verification link from Claude Code and complete the browser flow.",
      },
    };

    const args = ["auth", "login", mode === "console" ? "--console" : "--claudeai"];
    const child = this.spawnImpl(this.claudeBin, args, {
      cwd: this.baseEnv.HOME ?? process.cwd(),
      env: this.baseEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.activeLogin = { child };

    const handleChunk = (chunk: unknown) => {
      const output = String(chunk);
      const verificationUri =
        output.match(LOGIN_URL_PATTERN)?.[0] ??
        this.state.browserAuth.verificationUri;
      this.state = {
        ...this.state,
        updatedAt: this.now(),
        browserAuth: {
          ...this.state.browserAuth,
          verificationUri,
          instructions: output.trim() || this.state.browserAuth.instructions,
        },
      };
    };

    child.stdout.on("data", handleChunk);
    child.stderr.on("data", handleChunk);

    child.once("error", (error) => {
      if (!this.activeLogin) {
        return;
      }
      this.activeLogin = null;
      this.state = {
        ...this.state,
        status: "error",
        statusText: "Claude login failed to start.",
        updatedAt: this.now(),
        browserAuth: {
          ...this.state.browserAuth,
          status: "failed",
          completedAt: this.now(),
          lastError: error.message,
        },
      };
    });

    child.once("close", async (exitCode, signal) => {
      if (!this.activeLogin) {
        return;
      }
      this.activeLogin = null;
      const completedAt = this.now();
      const nextStatus = await this.refreshStatus().catch(() => this.snapshot());
      const loginSucceeded = nextStatus.status === "authenticated";
      const failureDetail =
        signal
          ? `Claude login exited with signal ${signal}.`
          : exitCode === 0
            ? null
            : `Claude login exited with code ${exitCode ?? "unknown"}.`;
      this.state = {
        ...nextStatus,
        updatedAt: completedAt,
        browserAuth: {
          ...this.state.browserAuth,
          status: loginSucceeded ? "completed" : "failed",
          completedAt,
          lastError: loginSucceeded ? null : failureDetail,
        },
      };
    });

    return this.snapshot();
  }

  async startUpdate(): Promise<ClaudeAccountRecord> {
    if (this.activeUpdate) {
      return this.snapshot();
    }
    if (this.activeLogin) {
      throw new Error("Claude login is in progress.");
    }

    const current = await this.refreshStatus();
    const plan = resolveCliUpdatePlan("claude", current.diagnostics);
    if (!plan.supported) {
      throw new Error("This Claude Code installation cannot be updated automatically.");
    }

    const startedAt = this.now();
    this.state = {
      ...this.state,
      updatedAt: startedAt,
      update: {
        ...this.state.update,
        supported: plan.supported,
        installMethod: plan.installMethod,
        commandPreview: plan.commandPreview,
        status: "pending",
        startedAt,
        completedAt: null,
        output: [],
        lastError: null,
      },
    };

    const child = this.spawnImpl(plan.command!, plan.args, {
      cwd: this.baseEnv.HOME ?? process.cwd(),
      env: this.baseEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.activeUpdate = { child };

    const handleChunk = (chunk: unknown) => {
      this.state = {
        ...this.state,
        updatedAt: this.now(),
        update: {
          ...this.state.update,
          output: [...this.state.update.output, String(chunk).trim()].filter(Boolean).slice(-120),
        },
      };
    };

    child.stdout.on("data", handleChunk);
    child.stderr.on("data", handleChunk);

    child.once("error", (error) => {
      if (!this.activeUpdate || this.activeUpdate.child !== child) {
        return;
      }

      this.activeUpdate = null;
      const completedAt = this.now();
      this.state = {
        ...this.state,
        updatedAt: completedAt,
        update: {
          ...this.state.update,
          status: "failed",
          completedAt,
          lastError: error.message,
        },
      };
    });

    child.once("close", async (exitCode, signal) => {
      if (!this.activeUpdate || this.activeUpdate.child !== child) {
        return;
      }

      this.activeUpdate = null;
      const completedAt = this.now();
      const nextStatus = await this.refreshStatus().catch(() => this.snapshot());
      const failureDetail =
        signal
          ? `CLI update exited with signal ${signal}.`
          : exitCode === 0
            ? null
            : `CLI update exited with code ${exitCode ?? "unknown"}.`;

      this.state = {
        ...nextStatus,
        updatedAt: completedAt,
        update: {
          ...this.state.update,
          supported: plan.supported,
          installMethod: plan.installMethod,
          commandPreview: plan.commandPreview,
          status: failureDetail ? "failed" : "completed",
          startedAt,
          completedAt,
          output: this.state.update.output,
          lastError: failureDetail,
        },
      };
    });

    return this.snapshot();
  }

  async logout(): Promise<ClaudeAccountRecord> {
    if (this.activeLogin) {
      this.activeLogin.child.kill("SIGTERM");
      this.activeLogin = null;
    }
    if (this.activeUpdate) {
      throw new Error("Claude Code update is in progress.");
    }

    await this.runCommand(["auth", "logout"]);
    const refreshed = await this.refreshStatus().catch(() => this.snapshot());
    this.state = {
      ...refreshed,
      updatedAt: this.now(),
      browserAuth: emptyBrowserAuthState(),
    };

    return this.snapshot();
  }

  private async refreshStatus(): Promise<ClaudeAccountRecord> {
    const diagnostics = await this.diagnosticsService.getDiagnostics();
    const update = createCliUpdateRecord("claude", diagnostics);
    const checkedAt = this.now();
    const homePath = this.baseEnv.HOME ?? null;
    let status: ClaudeAccountRecord["status"] =
      diagnostics.installStatus === "installed" ? "logged-out" : "unavailable";
    let statusText =
      diagnostics.installStatus === "installed"
        ? "Claude Code is not logged in."
        : "Claude Code CLI is unavailable.";
    let accountInfo = emptyAccountInfoState();
    let apiProvider: string | null = null;

    if (diagnostics.installStatus === "installed") {
      try {
        const result = await this.runCommand(["auth", "status"]);
        const output = [result.stdout.trim(), result.stderr.trim()]
          .filter(Boolean)
          .join("\n")
          .trim();
        const parsed = parseClaudeAuthOutput(output);
        status = parsed.status;
        statusText = parsed.statusText;
        accountInfo = parsed.accountInfo;
        apiProvider = parsed.apiProvider;
      } catch (error) {
        status = "error";
        statusText =
          error instanceof Error
            ? error.message
            : "Failed to read Claude auth status.";
      }
    }

    this.state = {
      ...this.state,
      status,
      statusText,
      homePath,
      updatedAt: checkedAt,
      accountInfo,
      apiProvider,
      loginMethods: claudeLoginMethods(),
      primaryLoginMethodId: "browser-login",
      diagnostics,
      update: {
        ...this.state.update,
        supported: update.supported,
        installMethod: diagnostics.installMethod,
        commandPreview: update.commandPreview,
      },
    };

    return this.snapshot();
  }

  private snapshot(): ClaudeAccountRecord {
    return {
      ...this.state,
      accountInfo: {
        ...this.state.accountInfo,
      },
      loginMethods: this.state.loginMethods.map((method) => ({
        ...method,
      })),
      diagnostics: {
        ...this.state.diagnostics,
      },
      update: {
        ...this.state.update,
        output: [...this.state.update.output],
      },
      browserAuth: {
        ...this.state.browserAuth,
      },
    };
  }

  private runCommand(args: string[]): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = this.spawnImpl(this.claudeBin, args, {
        cwd: this.baseEnv.HOME ?? process.cwd(),
        env: this.baseEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.once("error", reject);
      child.once("close", (exitCode, signal) => {
        resolve({
          exitCode,
          signal,
          stdout,
          stderr,
        });
      });
    });
  }
}
