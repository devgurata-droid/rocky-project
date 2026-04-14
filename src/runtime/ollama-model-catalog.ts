import type {
  RuntimeDescriptorRecord,
} from "../api/api-types.js";
import type { RuntimeModelOption } from "./runtime-types.js";

const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";

export interface OllamaModelCatalogOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface OllamaTagsResponse {
  models?: Array<{
    name?: string;
    model?: string;
  }>;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function labelForModel(model: string): string {
  const normalized = model.trim();
  if (!normalized) {
    return "Ollama model";
  }

  const [namePart, tagPart] = normalized.split(":", 2);
  if (!tagPart) {
    return normalized;
  }

  return `${namePart} · ${tagPart}`;
}

export function buildOllamaModelOption(model: string): RuntimeModelOption {
  return {
    id: model,
    label: labelForModel(model),
    provider: "ollama",
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null,
    supportedServiceTiers: [],
    defaultServiceTier: null,
  };
}

export class OllamaModelCatalog {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OllamaModelCatalogOptions = {}) {
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? DEFAULT_OLLAMA_BASE_URL);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async listInstalledModels(): Promise<string[]> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/tags`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        return [];
      }

      const payload = (await response.json()) as OllamaTagsResponse;
      return uniqueStrings(
        (payload.models ?? [])
          .flatMap((entry) => {
            const model = entry.model ?? entry.name ?? "";
            const normalized = model.trim();
            return normalized ? [normalized] : [];
          })
          .sort((left, right) => left.localeCompare(right))
      );
    } catch {
      return [];
    }
  }

  async listModelOptions(): Promise<RuntimeModelOption[]> {
    return (await this.listInstalledModels()).map(buildOllamaModelOption);
  }

  async buildRuntimeDescriptor(): Promise<RuntimeDescriptorRecord> {
    const modelOptions = await this.listModelOptions();

    return {
      kind: "ollama",
      label: "Ollama",
      provider: "ollama",
      defaultModel: modelOptions[0]?.id ?? null,
      modelOptions,
    };
  }

  resolveBaseUrl(): string {
    return this.baseUrl;
  }
}
