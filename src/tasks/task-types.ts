import type {
  RuntimeKind,
  RuntimeOllamaLaunchTarget,
  RuntimeReasoningEffort,
  RuntimeServiceTier,
} from "../runtime/runtime-types.js";

export type AgentTaskLifecycle = "active" | "archived";
export type AgentTaskRunStatus = "running" | "completed" | "failed" | "cancelled";
export type AgentTaskRunTriggerType = "manual_task" | "scheduled" | "event";

export interface AgentTaskScheduleRecord {
  enabled: boolean;
  intervalMinutes: number | null;
  nextRunAt: string | null;
  lastTriggeredAt: string | null;
}

export interface AgentTaskEventTriggerRecord {
  enabled: boolean;
  webhookToken: string;
  lastTriggeredAt: string | null;
}

export interface AgentTaskMessengerDeliveryRecord {
  enabled: boolean;
  chatId: string | null;
  threadId: string | null;
  lastDeliveredAt: string | null;
  lastError: string | null;
}

export interface AgentTaskRecord {
  id: string;
  agentId: string;
  name: string;
  description: string;
  prompt: string;
  runtimeKind: RuntimeKind;
  ollamaLaunchTarget: RuntimeOllamaLaunchTarget | null;
  model: string | null;
  reasoningEffort: RuntimeReasoningEffort | null;
  serviceTier: RuntimeServiceTier | null;
  enabled: boolean;
  lifecycle: AgentTaskLifecycle;
  archivedAt: string | null;
  sourceSessionId: string | null;
  schedule: AgentTaskScheduleRecord;
  eventTrigger: AgentTaskEventTriggerRecord;
  messengerDelivery: AgentTaskMessengerDeliveryRecord;
  lastRunId: string | null;
  lastSessionId: string | null;
  lastRunStatus: AgentTaskRunStatus | null;
  lastRunSummary: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTaskRunRecord {
  id: string;
  taskId: string;
  agentId: string;
  sessionId: string;
  runId: string;
  triggerType: AgentTaskRunTriggerType;
  triggerSource: string | null;
  status: AgentTaskRunStatus;
  runtimeKind: RuntimeKind;
  ollamaLaunchTarget: RuntimeOllamaLaunchTarget | null;
  model: string | null;
  reasoningEffort: RuntimeReasoningEffort | null;
  serviceTier: RuntimeServiceTier | null;
  prompt: string;
  startedAt: string;
  endedAt: string | null;
  summary: string | null;
  messengerDeliveredAt: string | null;
  messengerDeliveryError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTaskCreateInput {
  id?: string;
  name: string;
  description?: string | null;
  prompt: string;
  runtimeKind?: RuntimeKind;
  ollamaLaunchTarget?: RuntimeOllamaLaunchTarget | null;
  model?: string | null;
  reasoningEffort?: RuntimeReasoningEffort | null;
  serviceTier?: RuntimeServiceTier | null;
  enabled?: boolean;
  sourceSessionId?: string | null;
  schedule?: {
    enabled?: boolean;
    intervalMinutes?: number | null;
  } | null;
  eventTrigger?: {
    enabled?: boolean;
  } | null;
  messengerDelivery?: {
    enabled?: boolean;
    chatId?: string | null;
    threadId?: string | null;
  } | null;
}

export interface AgentTaskUpdateInput {
  taskId: string;
  name?: string;
  description?: string | null;
  prompt?: string;
  runtimeKind?: RuntimeKind;
  ollamaLaunchTarget?: RuntimeOllamaLaunchTarget | null;
  model?: string | null;
  reasoningEffort?: RuntimeReasoningEffort | null;
  serviceTier?: RuntimeServiceTier | null;
  enabled?: boolean;
  lifecycle?: AgentTaskLifecycle;
  schedule?: {
    enabled?: boolean;
    intervalMinutes?: number | null;
  } | null;
  eventTrigger?: {
    enabled?: boolean;
    regenerateWebhookToken?: boolean;
  } | null;
  messengerDelivery?: {
    enabled?: boolean;
    chatId?: string | null;
    threadId?: string | null;
  } | null;
}

export interface AgentTaskRunInput {
  taskId: string;
  triggerType?: AgentTaskRunTriggerType;
  triggerSource?: string | null;
  eventPayload?: unknown;
}
