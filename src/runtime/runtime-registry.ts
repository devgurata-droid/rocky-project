import { CodexCliRuntime } from "./codex-cli-runtime.js";
import { ClaudeCodeRuntime } from "./claude-code-runtime.js";
import { OllamaRuntime } from "./ollama-runtime.js";
import { resolveCodexBin } from "./codex-bin-resolver.js";
import { resolveClaudeCodeBin } from "./claude-code-bin-resolver.js";
import { resolveOllamaBin } from "./ollama-bin-resolver.js";
import { OllamaModelCatalog } from "./ollama-model-catalog.js";

import type { RuntimeAdapter } from "./runtime-adapter.js";
import type {
  RuntimeKind,
  RuntimeModelOption,
  RuntimeReasoningEffort,
  RuntimeServiceTier,
} from "./runtime-types.js";
import type { RuntimeDescriptorRecord } from "../api/api-types.js";

export interface RuntimeRegistryEntry {
  kind: RuntimeKind;
  label: string;
  provider: RuntimeModelOption["provider"];
  adapter: RuntimeAdapter;
  listDescriptor(): Promise<RuntimeDescriptorRecord>;
  resolveBin(
    requestedBin: string | undefined,
    env?: NodeJS.ProcessEnv
  ): Promise<string>;
}

const CODEX_REASONING_EFFORTS: RuntimeReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
];

const CODEX_SERVICE_TIERS: RuntimeServiceTier[] = ["fast"];
const CLAUDE_REASONING_EFFORTS: RuntimeReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "max",
];

function buildCodexModelOption(id: string, label: string): RuntimeModelOption {
  return {
    id,
    label,
    provider: "codex",
    supportedReasoningEfforts: CODEX_REASONING_EFFORTS,
    defaultReasoningEffort: "medium",
    supportedServiceTiers: CODEX_SERVICE_TIERS,
    defaultServiceTier: null,
  };
}

const CODEX_MODEL_OPTIONS: RuntimeModelOption[] = [
  buildCodexModelOption("gpt-5.4", "GPT-5.4"),
  buildCodexModelOption("gpt-5.4-mini", "GPT-5.4 mini"),
  buildCodexModelOption("gpt-5.3-codex", "GPT-5.3 Codex"),
];

const CLAUDE_MODEL_OPTIONS: RuntimeModelOption[] = [
  {
    id: "default",
    label: "Default (recommended) · Sonnet 4.6",
    provider: "claude",
    supportedReasoningEfforts: CLAUDE_REASONING_EFFORTS,
    defaultReasoningEffort: null,
    supportedServiceTiers: [],
    defaultServiceTier: null,
  },
  {
    id: "sonnet[1m]",
    label: "Sonnet (1M context) · Sonnet 4.6",
    provider: "claude",
    supportedReasoningEfforts: CLAUDE_REASONING_EFFORTS,
    defaultReasoningEffort: null,
    supportedServiceTiers: [],
    defaultServiceTier: null,
  },
  {
    id: "opus",
    label: "Opus · Opus 4.6",
    provider: "claude",
    supportedReasoningEfforts: CLAUDE_REASONING_EFFORTS,
    defaultReasoningEffort: null,
    supportedServiceTiers: [],
    defaultServiceTier: null,
  },
  {
    id: "opus[1m]",
    label: "Opus (1M context) · Opus 4.6",
    provider: "claude",
    supportedReasoningEfforts: CLAUDE_REASONING_EFFORTS,
    defaultReasoningEffort: null,
    supportedServiceTiers: [],
    defaultServiceTier: null,
  },
  {
    id: "haiku",
    label: "Haiku · Haiku 4.5",
    provider: "claude",
    supportedReasoningEfforts: CLAUDE_REASONING_EFFORTS,
    defaultReasoningEffort: null,
    supportedServiceTiers: [],
    defaultServiceTier: null,
  },
];

export class RuntimeRegistry {
  private readonly entries = new Map<RuntimeKind, RuntimeRegistryEntry>();

  constructor(entries: RuntimeRegistryEntry[]) {
    for (const entry of entries) {
      this.entries.set(entry.kind, entry);
    }
  }

  get(kind: RuntimeKind): RuntimeRegistryEntry {
    const entry = this.entries.get(kind);
    if (!entry) {
      throw new Error(`Unknown runtime kind: ${kind}`);
    }

    return entry;
  }

  async list(): Promise<RuntimeDescriptorRecord[]> {
    return Promise.all(
      [...this.entries.values()].map((entry) => entry.listDescriptor())
    );
  }
}

export function createDefaultRuntimeRegistry(
  baseEnv: NodeJS.ProcessEnv = process.env,
  options: {
    ollamaCatalog?: OllamaModelCatalog;
  } = {}
): RuntimeRegistry {
  const ollamaCatalog = options.ollamaCatalog ?? new OllamaModelCatalog();

  return new RuntimeRegistry([
    {
      kind: "codex-cli",
      label: "Codex CLI",
      provider: "codex",
      adapter: new CodexCliRuntime({
        baseEnv,
      }),
      listDescriptor: async () => ({
        kind: "codex-cli",
        label: "Codex CLI",
        provider: "codex",
        defaultModel: "gpt-5.4",
        modelOptions: CODEX_MODEL_OPTIONS,
      }),
      resolveBin: (requestedBin, env = baseEnv) => resolveCodexBin(requestedBin, env),
    },
    {
      kind: "claude-code",
      label: "Claude Code",
      provider: "claude",
      adapter: new ClaudeCodeRuntime({
        baseEnv,
      }),
      listDescriptor: async () => ({
        kind: "claude-code",
        label: "Claude Code",
        provider: "claude",
        defaultModel: "default",
        modelOptions: CLAUDE_MODEL_OPTIONS,
      }),
      resolveBin: (requestedBin, env = baseEnv) => resolveClaudeCodeBin(requestedBin, env),
    },
    {
      kind: "ollama",
      label: "Ollama",
      provider: "ollama",
      adapter: new OllamaRuntime({
        baseEnv,
        catalog: ollamaCatalog,
      }),
      listDescriptor: async () => ollamaCatalog.buildRuntimeDescriptor(),
      resolveBin: (requestedBin, env = baseEnv) => resolveOllamaBin(requestedBin, env),
    },
  ]);
}
