import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveAgentPaths } from "../agents/agent-manager.js";
import { readJsonFile, serializeJson } from "../sessions/session-store.js";

import type { SessionServiceLike } from "../api/api-types.js";
import type {
  AgentMessengerServiceLike,
  AgentMessengerSlotRecord,
  MessengerConnectionRecord,
  MessengerConversationBindingRecord,
  MessengerProvider,
  MessengerProviderDescriptorRecord,
  TelegramMessengerConnectionRecord,
  TelegramMessengerConnectionUpsertInput,
  TelegramUpdateRecord,
} from "./messenger-types.js";

const MESSENGER_PROVIDER_DESCRIPTORS: MessengerProviderDescriptorRecord[] = [
  {
    provider: "telegram",
    label: "Telegram",
    subtitle: "Bot long polling 연동",
    availability: "available",
    docsUrl: "https://core.telegram.org/bots/api#getupdates",
  },
  {
    provider: "kakao",
    label: "KakaoTalk",
    subtitle: "카카오톡 채널 챗봇 연동 예정",
    availability: "planned",
    docsUrl: null,
  },
  {
    provider: "slack",
    label: "Slack",
    subtitle: "DM 및 thread 연동 예정",
    availability: "planned",
    docsUrl: null,
  },
  {
    provider: "discord",
    label: "Discord",
    subtitle: "Bot gateway 연동 예정",
    availability: "planned",
    docsUrl: null,
  },
];

interface TelegramPollerState {
  abortController: AbortController;
  settled: Promise<void>;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function trimString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizePublicBaseUrl(value: string | null | undefined): string | null {
  const trimmed = trimString(value);
  if (!trimmed) {
    return null;
  }

  return trimTrailingSlash(trimmed);
}

function resolveConnectionPaths(stateRoot: string, agentId: string, provider: MessengerProvider) {
  const { agentRoot } = resolveAgentPaths({
    stateRoot,
    agentId,
  });
  const baseRoot = path.join(agentRoot, "messenger");

  return {
    connectionPath: path.join(baseRoot, "connections", `${provider}.json`),
    conversationsRoot: path.join(baseRoot, "conversations", provider),
  };
}

function readFirstNonEmpty(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = trimString(value);
    if (trimmed) {
      return trimmed;
    }
  }

  return null;
}

function hashConversationKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sessionTitleForTelegram(chatLabel: string): string {
  return `Telegram · ${chatLabel}`;
}

function extractTelegramConversationContext(payload: TelegramUpdateRecord): {
  messageText: string | null;
  externalUserId: string | null;
  externalChannelId: string | null;
  externalThreadId: string | null;
  chatId: string | null;
  replyMessageId: number | null;
  chatLabel: string;
  fromIsBot: boolean;
} {
  const message = payload.message;
  const fromId =
    typeof message?.from?.id === "number" || typeof message?.from?.id === "bigint"
      ? String(message.from.id)
      : null;
  const chatId =
    typeof message?.chat?.id === "number" || typeof message?.chat?.id === "bigint"
      ? String(message.chat.id)
      : null;
  const threadId =
    typeof message?.message_thread_id === "number" || typeof message?.message_thread_id === "bigint"
      ? String(message.message_thread_id)
      : null;
  const messageText = readFirstNonEmpty([message?.text ?? null, message?.caption ?? null]);
  const replyMessageId = typeof message?.message_id === "number" ? message.message_id : null;
  const chatLabel =
    readFirstNonEmpty([
      message?.chat?.title ?? null,
      message?.chat?.username ? `@${message.chat.username}` : null,
      message?.chat?.first_name ?? null,
      chatId,
    ]) ?? "chat";

  return {
    messageText,
    externalUserId: fromId,
    externalChannelId: chatId,
    externalThreadId: threadId,
    chatId,
    replyMessageId,
    chatLabel,
    fromIsBot: message?.from?.is_bot === true,
  };
}

function buildConversationKey(input: {
  agentId: string;
  provider: "telegram";
  externalUserId: string;
  externalChannelId: string | null;
  externalThreadId: string | null;
}): string {
  return [
    input.provider,
    input.agentId,
    input.externalChannelId ?? "default",
    input.externalThreadId ?? "root",
    input.externalUserId,
  ].join(":");
}

function parseTelegramApiResult<T>(payload: unknown): T {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Unexpected Telegram API response.");
  }

  const record = payload as Record<string, unknown>;
  if (record.ok !== true) {
    const description =
      typeof record.description === "string" ? record.description : "Telegram API request failed.";
    throw new Error(description);
  }

  return record.result as T;
}

function parseTelegramGetMe(payload: unknown): {
  botUserId: string;
  botUsername: string | null;
} {
  const result = parseTelegramApiResult<Record<string, unknown>>(payload);
  const userIdValue = result.id;
  const botUserId =
    typeof userIdValue === "number" || typeof userIdValue === "bigint"
      ? String(userIdValue)
      : typeof userIdValue === "string"
        ? userIdValue
        : null;
  if (!botUserId) {
    throw new Error("Telegram getMe response did not include id.");
  }

  return {
    botUserId,
    botUsername:
      typeof result.username === "string" && result.username.trim()
        ? result.username.trim()
        : null,
  };
}

function parseTelegramUpdates(payload: unknown): TelegramUpdateRecord[] {
  const result = parseTelegramApiResult<unknown>(payload);
  if (!Array.isArray(result)) {
    throw new Error("Telegram getUpdates response was not an array.");
  }

  return result as TelegramUpdateRecord[];
}

function truncateTelegramText(value: string, maxLength = 3500): string {
  const normalized = value.replace(/\r/g, "").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function buildResultSummary(input: {
  status: string;
  lastMessage: string | null;
  errors: string[];
  stderr: string[];
  sessionUrl: string | null;
}): string {
  if (input.status === "completed") {
    const body = trimString(input.lastMessage) ?? "마지막 응답이 비어 있습니다.";
    const link = input.sessionUrl ? `\n\n웹에서 이어서 보기:\n${input.sessionUrl}` : "";
    return truncateTelegramText(`작업을 마쳤습니다.\n\n${body}${link}`);
  }

  const detail =
    readFirstNonEmpty([input.errors[0] ?? null, input.stderr[0] ?? null]) ??
    "실행이 비정상 종료되었습니다.";
  const link = input.sessionUrl ? `\n\n세션 확인:\n${input.sessionUrl}` : "";

  return truncateTelegramText(`요청 처리 중 문제가 발생했습니다.\n\n${detail}${link}`);
}

function buildTaskResultSummary(input: {
  taskName: string;
  status: "completed" | "failed" | "cancelled";
  lastMessage: string | null;
  errors: string[];
  stderr: string[];
  sessionUrl: string | null;
}): string {
  if (input.status === "completed") {
    const body = trimString(input.lastMessage) ?? "최종 응답이 비어 있습니다.";
    const link = input.sessionUrl ? `\n\n세션 보기:\n${input.sessionUrl}` : "";
    return truncateTelegramText(`단일 작업 "${input.taskName}" 실행을 마쳤습니다.\n\n${body}${link}`);
  }

  const detail =
    readFirstNonEmpty([input.errors[0] ?? null, input.stderr[0] ?? null]) ??
    "실행이 비정상 종료되었습니다.";
  const link = input.sessionUrl ? `\n\n세션 보기:\n${input.sessionUrl}` : "";

  return truncateTelegramText(
    `단일 작업 "${input.taskName}" 실행 중 문제가 발생했습니다.\n\n${detail}${link}`
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isJsonSyntaxError(error: unknown): boolean {
  return error instanceof SyntaxError;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    }

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export interface AgentMessengerServiceOptions {
  stateRoot?: string;
  now?: () => string;
  sessionService: SessionServiceLike;
  fetchImpl?: typeof fetch;
}

export class AgentMessengerService implements AgentMessengerServiceLike {
  private readonly stateRoot: string;
  private readonly now: () => string;
  private readonly sessionService: SessionServiceLike;
  private readonly fetchImpl: typeof fetch;
  private readonly pollers = new Map<string, TelegramPollerState>();
  private readonly activeDispatches = new Set<Promise<void>>();
  private readonly connectionMutationChains = new Map<string, Promise<void>>();
  private started = false;
  private closing = false;

  constructor(options: AgentMessengerServiceOptions) {
    this.stateRoot = path.resolve(
      options.stateRoot ?? path.join(process.cwd(), ".runtime", "agent-engine")
    );
    this.now = options.now ?? (() => new Date().toISOString());
    this.sessionService = options.sessionService;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;
    this.closing = false;
    const agentIds = await this.listManagedAgentIds();
    await Promise.all(agentIds.map(async (agentId) => this.ensureTelegramPolling(agentId)));
  }

  async close(): Promise<void> {
    this.closing = true;
    this.started = false;

    const pollerStops = [...this.pollers.keys()].map(async (agentId) => this.stopTelegramPoller(agentId));
    await Promise.all(pollerStops);
    await Promise.allSettled([...this.activeDispatches]);
  }

  async listAgentMessengerSlots(agentId: string): Promise<AgentMessengerSlotRecord[]> {
    const connections = await Promise.all(
      MESSENGER_PROVIDER_DESCRIPTORS.map(async (descriptor) => ({
        descriptor,
        connection:
          descriptor.provider === "telegram"
            ? await this.readTelegramConnection(agentId)
            : null,
      }))
    );

    return connections.map(({ descriptor, connection }) => ({
      provider: descriptor.provider,
      descriptor,
      connection,
    }));
  }

  async upsertTelegramConnection(
    input: TelegramMessengerConnectionUpsertInput
  ): Promise<TelegramMessengerConnectionRecord> {
    const record = await this.runConnectionMutation(input.agentId, async () => {
      const existing = await this.readTelegramConnection(input.agentId);
      const timestamp = this.now();
      const nextRecord: TelegramMessengerConnectionRecord = {
        agentId: input.agentId,
        provider: "telegram",
        enabled: input.enabled ?? existing?.enabled ?? true,
        botToken: trimString(input.botToken) ?? existing?.botToken ?? null,
        botUsername: existing?.botUsername ?? null,
        botUserId: existing?.botUserId ?? null,
        publicBaseUrl:
          normalizePublicBaseUrl(input.publicBaseUrl) ?? existing?.publicBaseUrl ?? null,
        defaultAckText:
          trimString(input.defaultAckText) ??
          existing?.defaultAckText ??
          "요청을 접수했습니다. 처리 후 다시 알려드릴게요.",
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        lastReceivedAt: existing?.lastReceivedAt ?? null,
        lastDeliveredAt: existing?.lastDeliveredAt ?? null,
        lastSyncAt: existing?.lastSyncAt ?? null,
        lastPolledAt: existing?.lastPolledAt ?? null,
        lastConsumedUpdateId: existing?.lastConsumedUpdateId ?? null,
        lastSessionId: existing?.lastSessionId ?? null,
        lastRunId: existing?.lastRunId ?? null,
        lastError: existing?.lastError ?? null,
      };

      const syncedRecord = await this.syncTelegramConnection(nextRecord, existing);
      await this.writeConnectionRecord(syncedRecord);
      return syncedRecord;
    });

    if (this.started) {
      await this.ensureTelegramPolling(input.agentId);
    }

    return record;
  }

  async deleteAgentMessengerConnection(
    agentId: string,
    provider: MessengerProvider
  ): Promise<void> {
    if (provider === "telegram") {
      await this.stopTelegramPoller(agentId);
      const current = await this.readTelegramConnection(agentId);
      if (current?.botToken) {
        await this.deleteTelegramWebhook(current.botToken).catch(() => {
          // Removing the local connection is more important than unlinking the remote webhook.
        });
      }
    }

    const paths = resolveConnectionPaths(this.stateRoot, agentId, provider);
    if (await pathExists(paths.connectionPath)) {
      await rm(paths.connectionPath, {
        force: false,
      });
    }
  }

  async deliverTaskResult(input: {
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
  }): Promise<void> {
    const connection = await this.readTelegramConnection(input.agentId);
    if (!connection?.enabled || !connection.botToken) {
      throw new Error("Telegram connection is not configured for this agent.");
    }

    const sessionUrl = connection.publicBaseUrl
      ? `${trimTrailingSlash(connection.publicBaseUrl)}/agents/${encodeURIComponent(
          input.agentId
        )}/sessions/${encodeURIComponent(input.sessionId)}`
      : null;

    await this.sendTelegramMessage({
      connection,
      chatId: input.chatId,
      threadId: input.threadId,
      text: buildTaskResultSummary({
        taskName: input.taskName,
        status: input.status,
        lastMessage: input.lastMessage,
        errors: input.errors,
        stderr: input.stderr,
        sessionUrl,
      }),
      replyMessageId: null,
    });

    await this.patchTelegramConnection(input.agentId, (current) => ({
      ...current,
      lastDeliveredAt: this.now(),
      lastSessionId: input.sessionId,
      lastRunId: input.runId,
      lastError: null,
    }));
  }

  private async syncTelegramConnection(
    record: TelegramMessengerConnectionRecord,
    existing: TelegramMessengerConnectionRecord | null
  ): Promise<TelegramMessengerConnectionRecord> {
    let nextRecord: TelegramMessengerConnectionRecord = {
      ...record,
      lastError: null,
    };

    const previousToken = existing?.botToken ?? null;
    const currentToken = nextRecord.botToken;

    try {
      if (previousToken && previousToken !== currentToken) {
        await this.deleteTelegramWebhook(previousToken);
      }

      if (!currentToken) {
        return {
          ...nextRecord,
          botUsername: null,
          botUserId: null,
        };
      }

      const botInfo = await this.fetchTelegramBotProfile(currentToken);
      await this.deleteTelegramWebhook(currentToken);
      nextRecord = {
        ...nextRecord,
        botUsername: botInfo.botUsername,
        botUserId: botInfo.botUserId,
        lastSyncAt: this.now(),
        lastError: null,
      };
    } catch (error) {
      nextRecord = {
        ...nextRecord,
        lastError: error instanceof Error ? error.message : "Telegram polling sync failed.",
      };
    }

    return nextRecord;
  }

  private async ensureTelegramPolling(agentId: string): Promise<void> {
    await this.stopTelegramPoller(agentId);

    if (!this.started || this.closing) {
      return;
    }

    const connection = await this.readTelegramConnection(agentId);
    if (!connection?.enabled || !connection.botToken) {
      return;
    }

    const abortController = new AbortController();
    const settled = this.runTelegramPoller(agentId, abortController.signal).finally(() => {
      const current = this.pollers.get(agentId);
      if (current?.settled === settled) {
        this.pollers.delete(agentId);
      }
    });

    this.pollers.set(agentId, {
      abortController,
      settled,
    });
  }

  private async stopTelegramPoller(agentId: string): Promise<void> {
    const poller = this.pollers.get(agentId);
    if (!poller) {
      return;
    }

    this.pollers.delete(agentId);
    poller.abortController.abort();
    await poller.settled.catch(() => {
      // Abort races are expected during shutdown or config changes.
    });
  }

  private async runTelegramPoller(agentId: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted && !this.closing) {
      const connection = await this.readTelegramConnection(agentId);
      if (!connection?.enabled || !connection.botToken) {
        return;
      }

      try {
        const updates = await this.fetchTelegramUpdates(
          connection.botToken,
          connection.lastConsumedUpdateId,
          signal
        );

        if (signal.aborted || this.closing) {
          return;
        }

        await this.patchTelegramConnection(agentId, (current) => ({
          ...current,
          lastPolledAt: this.now(),
          lastError: null,
        }));

        for (const update of updates) {
          if (signal.aborted || this.closing) {
            return;
          }

          this.handleTelegramUpdate(connection, update);

          if (typeof update.update_id === "number") {
            await this.patchTelegramConnection(agentId, (current) => ({
              ...current,
              lastConsumedUpdateId: update.update_id ?? current.lastConsumedUpdateId,
            }));
          }
        }
      } catch (error) {
        if (signal.aborted || this.closing || isAbortError(error)) {
          return;
        }

        await this.patchTelegramConnection(agentId, (current) => ({
          ...current,
          lastError: error instanceof Error ? error.message : "Telegram polling failed.",
        }));
        await sleep(1500, signal).catch(() => {
          // Ignore abort races while backing off.
        });
      }
    }
  }

  private async fetchTelegramBotProfile(botToken: string): Promise<{
    botUserId: string;
    botUsername: string | null;
  }> {
    const response = await this.fetchImpl(this.buildTelegramApiUrl(botToken, "getMe"));
    if (!response.ok) {
      throw new Error(`Telegram getMe failed with ${response.status}.`);
    }

    return parseTelegramGetMe(await response.json());
  }

  private async fetchTelegramUpdates(
    botToken: string,
    lastConsumedUpdateId: number | null,
    signal: AbortSignal
  ): Promise<TelegramUpdateRecord[]> {
    const response = await this.fetchImpl(this.buildTelegramApiUrl(botToken, "getUpdates"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        offset:
          typeof lastConsumedUpdateId === "number" ? lastConsumedUpdateId + 1 : undefined,
        timeout: 20,
        allowed_updates: ["message"],
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Telegram getUpdates failed with ${response.status}.`);
    }

    return parseTelegramUpdates(await response.json());
  }

  private async deleteTelegramWebhook(botToken: string): Promise<void> {
    const response = await this.fetchImpl(this.buildTelegramApiUrl(botToken, "deleteWebhook"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        drop_pending_updates: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Telegram deleteWebhook failed with ${response.status}.`);
    }

    parseTelegramApiResult(await response.json());
  }

  private buildTelegramApiUrl(botToken: string, method: string): string {
    return `https://api.telegram.org/bot${botToken}/${method}`;
  }

  private handleTelegramUpdate(
    connection: TelegramMessengerConnectionRecord,
    payload: TelegramUpdateRecord
  ): void {
    const context = extractTelegramConversationContext(payload);
    if (
      context.fromIsBot ||
      !context.messageText ||
      !context.externalUserId ||
      !context.chatId
    ) {
      return;
    }

    const dispatch = this.dispatchTelegramConversation({
      connection,
      messageText: context.messageText,
      externalUserId: context.externalUserId,
      externalChannelId: context.externalChannelId,
      externalThreadId: context.externalThreadId,
      chatId: context.chatId,
      replyMessageId: context.replyMessageId,
      chatLabel: context.chatLabel,
    }).finally(() => {
      this.activeDispatches.delete(dispatch);
    });

    this.activeDispatches.add(dispatch);
  }

  private async dispatchTelegramConversation(input: {
    connection: TelegramMessengerConnectionRecord;
    messageText: string;
    externalUserId: string;
    externalChannelId: string | null;
    externalThreadId: string | null;
    chatId: string;
    replyMessageId: number | null;
    chatLabel: string;
  }): Promise<void> {
    const liveConnection =
      (await this.readTelegramConnection(input.connection.agentId)) ?? input.connection;

    await this.patchTelegramConnection(input.connection.agentId, (current) => ({
      ...current,
      lastReceivedAt: this.now(),
      lastError: null,
    }));

    try {
      if (liveConnection.botToken && liveConnection.defaultAckText) {
        await this.sendTelegramMessage({
          connection: liveConnection,
          chatId: input.chatId,
          threadId: input.externalThreadId,
          text: liveConnection.defaultAckText,
          replyMessageId: input.replyMessageId,
        });
      }

      const binding = await this.resolveConversationBinding({
        agentId: input.connection.agentId,
        externalUserId: input.externalUserId,
        externalChannelId: input.externalChannelId,
        externalThreadId: input.externalThreadId,
        chatLabel: input.chatLabel,
      });
      const run = await this.sessionService.sendTurn({
        sessionId: binding.sessionId,
        prompt: input.messageText,
      });
      const result = await this.sessionService.getRunResult(run.id);
      const sessionUrl = liveConnection.publicBaseUrl
        ? `${trimTrailingSlash(liveConnection.publicBaseUrl)}/agents/${encodeURIComponent(
            input.connection.agentId
          )}/sessions/${encodeURIComponent(binding.sessionId)}`
        : null;

      await this.sendTelegramMessage({
        connection: liveConnection,
        chatId: input.chatId,
        threadId: input.externalThreadId,
        text: buildResultSummary({
          status: result.status,
          lastMessage: result.lastMessage,
          errors: result.errors,
          stderr: result.stderr,
          sessionUrl,
        }),
        replyMessageId: null,
      });

      await this.patchTelegramConnection(input.connection.agentId, (current) => ({
        ...current,
        lastDeliveredAt: this.now(),
        lastSessionId: binding.sessionId,
        lastRunId: run.id,
        lastError: null,
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Telegram message dispatch failed.";

      await this.patchTelegramConnection(input.connection.agentId, (current) => ({
        ...current,
        lastError: message,
      }));

      if (liveConnection.botToken) {
        await this.sendTelegramMessage({
          connection: liveConnection,
          chatId: input.chatId,
          threadId: input.externalThreadId,
          text: truncateTelegramText(`요청을 처리하지 못했습니다.\n\n${message}`),
          replyMessageId: null,
        }).catch(() => {
          // Keep the original failure on disk; the outbound channel is already broken.
        });
      }
    }
  }

  private async sendTelegramMessage(input: {
    connection: TelegramMessengerConnectionRecord;
    chatId: string;
    threadId: string | null;
    text: string;
    replyMessageId: number | null;
  }): Promise<void> {
    if (!input.connection.botToken) {
      throw new Error("Telegram bot token is not configured.");
    }

    const response = await this.fetchImpl(
      this.buildTelegramApiUrl(input.connection.botToken, "sendMessage"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: input.chatId,
          text: truncateTelegramText(input.text),
          ...(input.threadId
            ? {
                message_thread_id: Number(input.threadId),
              }
            : {}),
          ...(input.replyMessageId
            ? {
                reply_parameters: {
                  message_id: input.replyMessageId,
                },
              }
            : {}),
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Telegram sendMessage failed with ${response.status}.`);
    }

    parseTelegramApiResult(await response.json());
  }

  private async resolveConversationBinding(input: {
    agentId: string;
    externalUserId: string;
    externalChannelId: string | null;
    externalThreadId: string | null;
    chatLabel: string;
  }): Promise<MessengerConversationBindingRecord> {
    const conversationKey = buildConversationKey({
      agentId: input.agentId,
      provider: "telegram",
      externalUserId: input.externalUserId,
      externalChannelId: input.externalChannelId,
      externalThreadId: input.externalThreadId,
    });
    const bindingPath = this.resolveConversationBindingPath(input.agentId, conversationKey);
    const timestamp = this.now();

    if (await pathExists(bindingPath)) {
      let binding: MessengerConversationBindingRecord | null = null;
      try {
        binding = await readJsonFile<MessengerConversationBindingRecord>(bindingPath);
      } catch (error) {
        if (!isJsonSyntaxError(error)) {
          throw error;
        }

        await this.quarantineCorruptJson(bindingPath);
      }

      if (binding) {
        try {
          const session = await this.sessionService.getSession(binding.sessionId);
          if (session.lifecycle !== "archived") {
            const nextBinding: MessengerConversationBindingRecord = {
              ...binding,
              updatedAt: timestamp,
              lastMessageAt: timestamp,
            };
            await this.writeConversationBinding(bindingPath, nextBinding);
            return nextBinding;
          }
        } catch {
          // Recreate the session binding below.
        }
      }
    }

    const session = await this.sessionService.createSession({
      agentId: input.agentId,
      title: sessionTitleForTelegram(input.chatLabel),
    });
    const binding: MessengerConversationBindingRecord = {
      agentId: input.agentId,
      provider: "telegram",
      conversationKey,
      sessionId: session.id,
      externalUserId: input.externalUserId,
      externalChannelId: input.externalChannelId,
      externalThreadId: input.externalThreadId,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastMessageAt: timestamp,
    };

    await this.writeConversationBinding(bindingPath, binding);
    return binding;
  }

  private resolveConversationBindingPath(agentId: string, conversationKey: string): string {
    const paths = resolveConnectionPaths(this.stateRoot, agentId, "telegram");
    return path.join(paths.conversationsRoot, `${hashConversationKey(conversationKey)}.json`);
  }

  private async listManagedAgentIds(): Promise<string[]> {
    const agentsRoot = path.join(this.stateRoot, "agents");
    if (!(await pathExists(agentsRoot))) {
      return [];
    }

    const entries = await readdir(agentsRoot, {
      withFileTypes: true,
    });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  }

  private async readTelegramConnection(
    agentId: string
  ): Promise<TelegramMessengerConnectionRecord | null> {
    const paths = resolveConnectionPaths(this.stateRoot, agentId, "telegram");
    if (!(await pathExists(paths.connectionPath))) {
      return null;
    }

    try {
      return await readJsonFile<TelegramMessengerConnectionRecord>(paths.connectionPath);
    } catch (error) {
      if (!isJsonSyntaxError(error)) {
        throw error;
      }

      await this.quarantineCorruptJson(paths.connectionPath);
      return null;
    }
  }

  private async writeConnectionRecord(record: MessengerConnectionRecord): Promise<void> {
    const paths = resolveConnectionPaths(this.stateRoot, record.agentId, record.provider);
    await mkdir(path.dirname(paths.connectionPath), {
      recursive: true,
    });
    await this.writeJsonAtomically(paths.connectionPath, serializeJson(record));
  }

  private async writeConversationBinding(
    bindingPath: string,
    binding: MessengerConversationBindingRecord
  ): Promise<void> {
    await mkdir(path.dirname(bindingPath), {
      recursive: true,
    });
    await this.writeJsonAtomically(bindingPath, serializeJson(binding));
  }

  private async patchTelegramConnection(
    agentId: string,
    updater: (current: TelegramMessengerConnectionRecord) => TelegramMessengerConnectionRecord
  ): Promise<void> {
    await this.runConnectionMutation(agentId, async () => {
      const current = await this.readTelegramConnection(agentId);
      if (!current) {
        return;
      }

      await this.writeConnectionRecord(
        updater({
          ...current,
          updatedAt: this.now(),
        })
      );
    });
  }

  private runConnectionMutation<T>(
    agentId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = this.connectionMutationChains.get(agentId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    this.connectionMutationChains.set(
      agentId,
      result.then(
        () => undefined,
        () => undefined
      )
    );
    return result;
  }

  private async writeJsonAtomically(targetPath: string, content: string): Promise<void> {
    const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, targetPath);
  }

  private async quarantineCorruptJson(targetPath: string): Promise<void> {
    if (!(await pathExists(targetPath))) {
      return;
    }

    const quarantinedPath = `${targetPath}.corrupt.${process.pid}.${Date.now()}`;
    await rename(targetPath, quarantinedPath);
  }
}
