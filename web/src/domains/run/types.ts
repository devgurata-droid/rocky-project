export interface AgentRunRecord {
  id: string;
  agentId: string;
  sessionId: string;
  runtimeRunId: string | null;
  triggerType: string;
  status: string;
  runtimeKind?: "codex-cli" | "claude-code" | "ollama";
  ollamaLaunchTarget?: "codex" | "claude" | null;
  model: string | null;
  reasoningEffort: string | null;
  serviceTier: string | null;
  prompt: string;
  startedAt: string;
  endedAt: string | null;
  summary: string | null;
  runtimeSessionId: string | null;
  outputLastMessagePath: string | null;
  resultPath: string;
  eventsPath: string;
  artifactsDir: string;
}

export interface RuntimeEvent {
  source: string;
  type: string;
  runId: string | null;
  sessionId: string | null;
  runtimeSessionId: string | null;
  rawType: string;
  occurredAt: string;
  data: Record<string, unknown>;
  raw: unknown;
}

export interface RuntimeRunResult {
  runId: string;
  sessionId: string;
  runtimeSessionId: string | null;
  sessionBinding: {
    runtimeSessionId: string;
    boundAt: string;
    source: string;
  } | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  signal: string | null;
  messages: Array<{
    role: string;
    text: string;
    itemType: string | null;
    occurredAt: string;
    source: string;
  }>;
  warnings: Array<Record<string, unknown>>;
  errors: string[];
  stderr: string[];
  artifactRefs: Array<{
    kind: string;
    role: string;
    path: string;
  }>;
  lastMessage: string | null;
  outputLastMessagePath: string | null;
  rawEvents: unknown[];
}

export interface RunArtifactRecord {
  kind: string;
  role: string;
  name: string;
  contentType: string;
  presentation: "file" | "image" | "chart";
  size: number | null;
  previewable: boolean;
  previewUrl: string | null;
  downloadUrl: string;
  preferredAction: "preview" | "download";
}
