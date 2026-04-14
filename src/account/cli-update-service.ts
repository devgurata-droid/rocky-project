import { spawn as defaultSpawn } from "node:child_process";

import type { SpawnLike } from "../runtime/runtime-types.js";
import type {
  CliInstallMethod,
  CliUpdateRecord,
  CliVersionDiagnosticsRecord,
  ProviderKind,
} from "./provider-account-types.js";

type DiagnosticsWithoutInstallMethod = Omit<
  CliVersionDiagnosticsRecord,
  "installMethod"
>;

interface CliUpdatePlan {
  supported: boolean;
  installMethod: CliInstallMethod;
  commandPreview: string | null;
  command: string | null;
  args: string[];
}

export interface CliUpdateCommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

interface RunCliUpdateOptions {
  plan: CliUpdatePlan;
  spawn?: SpawnLike;
  baseEnv?: NodeJS.ProcessEnv;
  cwd?: string;
}

function packageNameForProvider(provider: ProviderKind): string {
  return provider === "codex" ? "@openai/codex" : "@anthropic-ai/claude-code";
}

function caskNameForProvider(provider: ProviderKind): string {
  return provider === "codex" ? "codex" : "claude-code";
}

function detectInstallMethod(
  provider: ProviderKind,
  diagnostics: Pick<CliVersionDiagnosticsRecord, "resolvedPath">
): CliInstallMethod {
  const resolvedPath = diagnostics.resolvedPath ?? "";
  if (
    (provider === "codex" && resolvedPath.includes("/Caskroom/codex/")) ||
    (provider === "claude" && resolvedPath.includes("/Caskroom/claude-code/"))
  ) {
    return "homebrew-cask";
  }

  if (
    resolvedPath.includes("/.nvm/versions/") ||
    resolvedPath.includes("/lib/node_modules/") ||
    resolvedPath.includes("/node_modules/")
  ) {
    return "npm-global";
  }

  return "unknown";
}

export function enrichDiagnosticsWithInstallMethod(
  provider: ProviderKind,
  diagnostics: DiagnosticsWithoutInstallMethod
): CliVersionDiagnosticsRecord {
  return {
    ...diagnostics,
    installMethod: detectInstallMethod(provider, diagnostics),
  };
}

export function createCliUpdateRecord(
  provider: ProviderKind,
  diagnostics: CliVersionDiagnosticsRecord
): CliUpdateRecord {
  const plan = resolveCliUpdatePlan(provider, diagnostics);
  return {
    status: "idle",
    supported: plan.supported,
    installMethod: plan.installMethod,
    commandPreview: plan.commandPreview,
    startedAt: null,
    completedAt: null,
    output: [],
    lastError: null,
  };
}

export function resolveCliUpdatePlan(
  provider: ProviderKind,
  diagnostics: CliVersionDiagnosticsRecord
): CliUpdatePlan {
  const installMethod = diagnostics.installMethod;
  if (diagnostics.installStatus !== "installed") {
    return {
      supported: false,
      installMethod,
      commandPreview: null,
      command: null,
      args: [],
    };
  }

  if (installMethod === "homebrew-cask") {
    const caskName = caskNameForProvider(provider);
    return {
      supported: true,
      installMethod,
      commandPreview: `brew upgrade --cask ${caskName}`,
      command: "brew",
      args: ["upgrade", "--cask", caskName],
    };
  }

  if (installMethod === "npm-global") {
    const packageName = packageNameForProvider(provider);
    return {
      supported: true,
      installMethod,
      commandPreview: `npm install -g ${packageName}@latest`,
      command: "npm",
      args: ["install", "-g", `${packageName}@latest`],
    };
  }

  return {
    supported: false,
    installMethod,
    commandPreview: null,
    command: null,
    args: [],
  };
}

export async function runCliUpdate(
  options: RunCliUpdateOptions
): Promise<CliUpdateCommandResult> {
  const spawnImpl = options.spawn ?? (defaultSpawn as unknown as SpawnLike);
  const { plan } = options;
  if (!plan.supported || !plan.command) {
    throw new Error("This CLI installation cannot be updated automatically.");
  }

  return await new Promise((resolve, reject) => {
    const child = spawnImpl(plan.command, plan.args, {
      cwd: options.cwd ?? options.baseEnv?.HOME ?? process.cwd(),
      env: options.baseEnv ?? process.env,
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
