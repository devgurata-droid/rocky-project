export type MessengerProvider = "kakao" | "telegram" | "slack" | "discord";
export type MessengerProviderAvailability = "available" | "planned";

export interface MessengerProviderDescriptorRecord {
  provider: MessengerProvider;
  label: string;
  subtitle: string;
  availability: MessengerProviderAvailability;
  docsUrl: string | null;
}

export interface TelegramMessengerConnectionRecord {
  agentId: string;
  provider: "telegram";
  enabled: boolean;
  botToken: string | null;
  botUsername: string | null;
  botUserId: string | null;
  publicBaseUrl: string | null;
  defaultAckText: string | null;
  createdAt: string;
  updatedAt: string;
  lastReceivedAt: string | null;
  lastDeliveredAt: string | null;
  lastSyncAt: string | null;
  lastPolledAt: string | null;
  lastConsumedUpdateId: number | null;
  lastSessionId: string | null;
  lastRunId: string | null;
  lastError: string | null;
}

export type MessengerConnectionRecord = TelegramMessengerConnectionRecord;

export interface MessengerConversationBindingRecord {
  agentId: string;
  provider: "telegram";
  conversationKey: string;
  sessionId: string;
  externalUserId: string;
  externalChannelId: string | null;
  externalThreadId: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
}

export interface AgentMessengerSlotRecord {
  provider: MessengerProvider;
  descriptor: MessengerProviderDescriptorRecord;
  connection: MessengerConnectionRecord | null;
}

export interface MessengerSlotsResponse {
  slots: AgentMessengerSlotRecord[];
  updatedAt: string;
}

export interface TelegramMessengerConnectionUpsertInput {
  agentId: string;
  provider: "telegram";
  enabled?: boolean;
  botToken?: string | null;
  publicBaseUrl?: string | null;
  defaultAckText?: string | null;
}

export interface TelegramUpdateRecord {
  update_id?: number;
  message?: {
    message_id?: number;
    message_thread_id?: number;
    text?: string;
    caption?: string;
    from?: {
      id?: number;
      is_bot?: boolean;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    chat?: {
      id?: number;
      type?: string;
      title?: string;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
  };
}

export interface AgentMessengerServiceLike {
  start?(): Promise<void>;
  close?(): Promise<void>;
  listAgentMessengerSlots(agentId: string): Promise<AgentMessengerSlotRecord[]>;
  upsertTelegramConnection(
    input: TelegramMessengerConnectionUpsertInput
  ): Promise<TelegramMessengerConnectionRecord>;
  deleteAgentMessengerConnection(
    agentId: string,
    provider: MessengerProvider
  ): Promise<void>;
  deliverTaskResult?(input: {
    agentId: string;
    taskName: string;
    sessionId: string;
    runId: string;
    status: "completed" | "failed" | "cancelled";
    chatId: string;
    threadId: string | null;
    lastMessage: string | null;
    errors: string[];
    stderr: string[];
  }): Promise<void>;
}
