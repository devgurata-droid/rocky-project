import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAgentEngineServer } from "../../src/api/agent-engine-server.js";

import type {
  AgentMessengerServiceLike,
  AgentMessengerSlotRecord,
  TelegramMessengerConnectionRecord,
} from "../../src/messenger/messenger-types.js";

function buildTelegramConnection(
  overrides: Partial<TelegramMessengerConnectionRecord> = {}
): TelegramMessengerConnectionRecord {
  return {
    agentId: "agent-1",
    provider: "telegram",
    enabled: true,
    botToken: "telegram-bot-token",
    botUsername: "rocky_test_bot",
    botUserId: "123456789",
    publicBaseUrl: "http://localhost:4173",
    defaultAckText: "요청을 접수했습니다.",
    createdAt: "2026-04-06T00:00:00.000Z",
    updatedAt: "2026-04-06T00:00:00.000Z",
    lastReceivedAt: null,
    lastDeliveredAt: null,
    lastSyncAt: null,
    lastPolledAt: null,
    lastConsumedUpdateId: null,
    lastSessionId: null,
    lastRunId: null,
    lastError: null,
    ...overrides,
  };
}

test("messenger routes expose slot listing, Telegram upsert, and delete", async () => {
  const calls: string[] = [];
  const fakeSlots: AgentMessengerSlotRecord[] = [
    {
      provider: "telegram",
      descriptor: {
        provider: "telegram",
        label: "Telegram",
        subtitle: "Bot long polling 연동",
        availability: "available",
        docsUrl: "https://core.telegram.org/bots/api#getupdates",
      },
      connection: buildTelegramConnection(),
    },
  ];
  const fakeService: AgentMessengerServiceLike = {
    async listAgentMessengerSlots(agentId) {
      calls.push(`list:${agentId}`);
      return fakeSlots;
    },
    async upsertTelegramConnection(input) {
      calls.push(`upsert:${input.agentId}:${input.provider}`);
      return buildTelegramConnection({
        enabled: input.enabled ?? true,
        botToken: input.botToken ?? null,
        publicBaseUrl: input.publicBaseUrl ?? null,
        defaultAckText: input.defaultAckText ?? null,
      });
    },
    async deleteAgentMessengerConnection(agentId, provider) {
      calls.push(`delete:${agentId}:${provider}`);
    },
  };

  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "messenger-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    agentMessengerService: fakeService,
  });
  await server.listen({
    host: "127.0.0.1",
    port: 0,
  });

  try {
    const address = server.server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const listResponse = await fetch(`${baseUrl}/agents/agent-1/messenger-connections`);
    assert.equal(listResponse.status, 200);
    const listBody = (await listResponse.json()) as {
      slots: AgentMessengerSlotRecord[];
    };
    assert.equal(listBody.slots.length, 1);
    assert.equal(listBody.slots[0]?.provider, "telegram");

    const upsertResponse = await fetch(`${baseUrl}/agents/agent-1/messenger-connections/telegram`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
        botToken: "telegram-bot-token",
        publicBaseUrl: "http://localhost:4173",
      }),
    });
    assert.equal(upsertResponse.status, 200);
    const upsertBody = (await upsertResponse.json()) as TelegramMessengerConnectionRecord;
    assert.equal(upsertBody.provider, "telegram");
    assert.equal(upsertBody.botToken, "telegram-bot-token");

    const deleteResponse = await fetch(
      `${baseUrl}/agents/agent-1/messenger-connections/kakao`,
      {
        method: "DELETE",
      }
    );
    assert.equal(deleteResponse.status, 204);

    assert.deepEqual(calls, [
      "list:agent-1",
      "upsert:agent-1:telegram",
      "delete:agent-1:kakao",
    ]);
  } finally {
    await server.close();
  }
});
