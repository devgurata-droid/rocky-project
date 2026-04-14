import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AgentMessengerService } from "../../src/messenger/agent-messenger-service.js";

import type { SessionServiceLike } from "../../src/api/api-types.js";
import type { RuntimeRunResult } from "../../src/runtime/runtime-types.js";
import type {
  AgentRunRecord,
  AgentSessionMessage,
  AgentSessionRecord,
} from "../../src/sessions/session-types.js";

function buildSession(sessionId: string): AgentSessionRecord {
  return {
    id: sessionId,
    agentId: "agent-1",
    kind: "task-request",
    title: `Telegram · ${sessionId}`,
    runtimeKind: "codex-cli",
    runtimeSessionId: null,
    workspaceRoot: "/srv/agent-1/workspace",
    runtimeHome: "/srv/agent-1/runtime-home",
    status: "active",
    lifecycle: "active",
    archivedAt: null,
    authProfileId: null,
    runtimeConfig: {
      codexBin: "codex",
      sandbox: "workspace-write",
      approval: null,
      profile: null,
      authProfileId: null,
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      fullAuto: false,
      dangerouslyBypassApprovalsAndSandbox: false,
      additionalWritableDirs: [],
      configOverrides: [],
      enableFeatures: [],
      disableFeatures: [],
      skipGitRepoCheck: true,
      ephemeral: false,
    },
    createdAt: "2026-04-06T00:00:00.000Z",
    lastActivityAt: "2026-04-06T00:00:00.000Z",
  };
}

function buildSessionServiceStub() {
  const sessions = new Map<string, AgentSessionRecord>();
  const runs = new Map<string, RuntimeRunResult>();
  const createSessionCalls: string[] = [];
  const sendTurnCalls: Array<{ sessionId: string; prompt: string }> = [];
  let runCounter = 0;
  let sessionCounter = 0;

  const service: SessionServiceLike = {
    async createSession(input) {
      sessionCounter += 1;
      const session = buildSession(`session-${sessionCounter}`);
      session.agentId = input.agentId;
      session.title = input.title ?? session.title;
      sessions.set(session.id, session);
      createSessionCalls.push(session.id);
      return session;
    },
    async listAgentSessions() {
      return [...sessions.values()];
    },
    async updateSession() {
      throw new Error("Not implemented in test stub.");
    },
    async getSession(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) {
        throw new Error(`Unknown session: ${sessionId}`);
      }

      return session;
    },
    async getTranscript(): Promise<AgentSessionMessage[]> {
      return [];
    },
    async deleteSession() {},
    async stopSessionRuns() {
      return [];
    },
    async sendTurn(input) {
      runCounter += 1;
      const runId = `run-${runCounter}`;
      sendTurnCalls.push({
        sessionId: input.sessionId,
        prompt: input.prompt,
      });

      runs.set(runId, {
        runId,
        sessionId: input.sessionId,
        runtimeSessionId: `runtime-${input.sessionId}`,
        sessionBinding: null,
        status: "completed",
        startedAt: "2026-04-06T00:00:01.000Z",
        endedAt: "2026-04-06T00:00:02.000Z",
        exitCode: 0,
        signal: null,
        command: "fake",
        args: [],
        warnings: [],
        errors: [],
        stderr: [],
        artifactRefs: [],
        lastMessage: `reply:${input.prompt}`,
        outputLastMessagePath: null,
        rawEvents: [],
        messages: [
          {
            role: "assistant",
            text: `reply:${input.prompt}`,
            itemType: "message",
            occurredAt: "2026-04-06T00:00:02.000Z",
            source: "message.completed",
          },
        ],
      });

      return {
        id: runId,
        agentId: "agent-1",
        sessionId: input.sessionId,
        runtimeRunId: null,
        triggerType: "interactive",
        status: "running",
        model: null,
        reasoningEffort: null,
        serviceTier: null,
        prompt: input.prompt,
        summary: null,
        startedAt: "2026-04-06T00:00:01.000Z",
        endedAt: null,
        runtimeSessionId: null,
        outputLastMessagePath: null,
        resultPath: `/runs/${runId}/result.json`,
        eventsPath: `/runs/${runId}/events.jsonl`,
        artifactsDir: `/runs/${runId}/artifacts`,
      } satisfies AgentRunRecord;
    },
    streamRunEvents() {
      return (async function* () {
        return;
      })();
    },
    async getRun(runId) {
      const result = runs.get(runId);
      if (!result) {
        throw new Error(`Unknown run: ${runId}`);
      }

      return {
        id: runId,
        agentId: "agent-1",
        sessionId: result.sessionId,
        runtimeRunId: null,
        triggerType: "interactive",
        status: result.status as AgentRunRecord["status"],
        model: null,
        reasoningEffort: null,
        serviceTier: null,
        prompt: sendTurnCalls.find((call, index) => `run-${index + 1}` === runId)?.prompt ?? "",
        summary: result.lastMessage,
        startedAt: result.startedAt,
        endedAt: result.endedAt,
        runtimeSessionId: result.runtimeSessionId,
        outputLastMessagePath: null,
        resultPath: `/runs/${runId}/result.json`,
        eventsPath: `/runs/${runId}/events.jsonl`,
        artifactsDir: `/runs/${runId}/artifacts`,
      } satisfies AgentRunRecord;
    },
    async getRunResult(runId) {
      const result = runs.get(runId);
      if (!result) {
        throw new Error(`Unknown run: ${runId}`);
      }

      return result;
    },
    async cancelRun() {},
    async stopAgentRuns() {
      return [];
    },
  };

  return {
    service,
    createSessionCalls,
    sendTurnCalls,
  };
}

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();
  while (!check()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out while waiting for async condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function buildAbortError(): Error {
  return Object.assign(new Error("Aborted"), {
    name: "AbortError",
  });
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

test("AgentMessengerService persists Telegram polling settings and exposes provider slots", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-messenger-"));
  const { service: sessionService } = buildSessionServiceStub();
  const fetchCalls: string[] = [];
  const messenger = new AgentMessengerService({
    stateRoot,
    sessionService,
    now: () => "2026-04-06T01:00:00.000Z",
    fetchImpl: async (input) => {
      const url = String(input);
      fetchCalls.push(url);

      if (url.endsWith("/getMe")) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: {
              id: 123456789,
              username: "rocky_test_bot",
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          }
        );
      }

      if (url.endsWith("/deleteWebhook")) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: true,
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          }
        );
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    },
  });

  const initialSlots = await messenger.listAgentMessengerSlots("agent-1");
  assert.equal(initialSlots.length, 4);
  assert.equal(initialSlots[0]?.provider, "telegram");
  assert.equal(initialSlots[0]?.descriptor.availability, "available");
  assert.equal(initialSlots[1]?.provider, "kakao");
  assert.equal(initialSlots[1]?.descriptor.availability, "planned");
  assert.equal(initialSlots[0]?.connection, null);

  const connection = await messenger.upsertTelegramConnection({
    agentId: "agent-1",
    provider: "telegram",
    publicBaseUrl: "http://localhost:4173/",
    botToken: "telegram-bot-token",
    enabled: true,
  });

  assert.equal(connection.agentId, "agent-1");
  assert.equal(connection.botUsername, "rocky_test_bot");
  assert.equal(connection.botUserId, "123456789");
  assert.equal(connection.publicBaseUrl, "http://localhost:4173");
  assert.equal(connection.lastSyncAt, "2026-04-06T01:00:00.000Z");
  assert.equal(fetchCalls.length, 2);
  assert.ok(fetchCalls[0]?.endsWith("/getMe"));
  assert.ok(fetchCalls[1]?.endsWith("/deleteWebhook"));

  const slots = await messenger.listAgentMessengerSlots("agent-1");
  assert.equal(slots[0]?.connection?.botUsername, "rocky_test_bot");
});

test("AgentMessengerService polls Telegram updates, reuses conversation bindings, and posts follow-up messages", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-messenger-"));
  const { service: sessionService, createSessionCalls, sendTurnCalls } =
    buildSessionServiceStub();
  const fetchCalls: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  let getUpdatesCallCount = 0;

  const messenger = new AgentMessengerService({
    stateRoot,
    sessionService,
    now: () => "2026-04-06T02:00:00.000Z",
    fetchImpl: async (input, init) => {
      const url = String(input);
      const body =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : null;
      fetchCalls.push({
        url,
        body,
      });

      if (url.endsWith("/getMe")) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: {
              id: 123456789,
              username: "rocky_test_bot",
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          }
        );
      }

      if (url.endsWith("/deleteWebhook")) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: true,
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          }
        );
      }

      if (url.endsWith("/getUpdates")) {
        getUpdatesCallCount += 1;
        if (getUpdatesCallCount === 1) {
          return new Response(
            JSON.stringify({
              ok: true,
              result: [
                {
                  update_id: 301,
                  message: {
                    message_id: 11,
                    text: "첫 번째 요청",
                    from: {
                      id: 1001,
                    },
                    chat: {
                      id: 2001,
                      type: "private",
                      first_name: "Tester",
                    },
                  },
                },
              ],
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
              },
            }
          );
        }

        if (getUpdatesCallCount === 2) {
          return new Response(
            JSON.stringify({
              ok: true,
              result: [
                {
                  update_id: 302,
                  message: {
                    message_id: 12,
                    text: "두 번째 요청",
                    from: {
                      id: 1001,
                    },
                    chat: {
                      id: 2001,
                      type: "private",
                      first_name: "Tester",
                    },
                  },
                },
              ],
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
              },
            }
          );
        }

        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          if (signal?.aborted) {
            reject(buildAbortError());
            return;
          }

          signal?.addEventListener(
            "abort",
            () => {
              reject(buildAbortError());
            },
            { once: true }
          );
        });
      }

      if (url.endsWith("/sendMessage")) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: true,
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          }
        );
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    },
  });

  await messenger.upsertTelegramConnection({
    agentId: "agent-1",
    provider: "telegram",
    publicBaseUrl: "http://localhost:4173",
    botToken: "telegram-bot-token",
  });

  await messenger.start();
  await waitFor(() => sendTurnCalls.length === 2);
  await messenger.close();

  assert.equal(createSessionCalls.length, 1);
  assert.equal(sendTurnCalls.length, 2);
  assert.equal(sendTurnCalls[0]?.sessionId, sendTurnCalls[1]?.sessionId);
  assert.equal(sendTurnCalls[0]?.prompt, "첫 번째 요청");
  assert.equal(sendTurnCalls[1]?.prompt, "두 번째 요청");

  const slots = await messenger.listAgentMessengerSlots("agent-1");
  assert.equal(slots[0]?.connection?.lastConsumedUpdateId, 302);
  assert.equal(slots[0]?.connection?.lastPolledAt, "2026-04-06T02:00:00.000Z");

  const sendMessageCalls = fetchCalls.filter((call) => call.url.endsWith("/sendMessage"));
  assert.equal(sendMessageCalls.length, 4);
  assert.equal(sendMessageCalls[0]?.body?.chat_id, "2001");
  assert.match(String(sendMessageCalls[0]?.body?.text ?? ""), /요청을 접수했습니다/);

  const finalTexts = sendMessageCalls
    .map((call) => String(call.body?.text ?? ""))
    .filter((text) => text.includes("작업을 마쳤습니다."));
  assert.equal(finalTexts.length, 2);
  assert.match(finalTexts[0] ?? "", /reply:첫 번째 요청/);
  assert.match(finalTexts[0] ?? "", /http:\/\/localhost:4173\/agents\/agent-1\/sessions\//);
});

test("AgentMessengerService quarantines malformed Telegram connection JSON and recovers on save", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-messenger-"));
  const { service: sessionService } = buildSessionServiceStub();
  const messenger = new AgentMessengerService({
    stateRoot,
    sessionService,
    now: () => "2026-04-07T00:00:00.000Z",
    fetchImpl: async (input) => {
      const url = String(input);

      if (url.endsWith("/getMe")) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: {
              id: 123456789,
              username: "rocky_test_bot",
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          }
        );
      }

      if (url.endsWith("/deleteWebhook")) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: true,
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          }
        );
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    },
  });

  const connectionDir = path.join(
    stateRoot,
    "agents",
    "agent-1",
    "messenger",
    "connections"
  );
  const connectionPath = path.join(connectionDir, "telegram.json");
  await mkdir(connectionDir, { recursive: true });
  await writeFile(connectionPath, "{", "utf8");

  const slots = await messenger.listAgentMessengerSlots("agent-1");
  assert.equal(slots[0]?.connection, null);
  assert.equal(await fileExists(connectionPath), false);

  const quarantinedFiles = (await readdir(connectionDir)).filter((entry) =>
    entry.startsWith("telegram.json.corrupt.")
  );
  assert.equal(quarantinedFiles.length, 1);

  const connection = await messenger.upsertTelegramConnection({
    agentId: "agent-1",
    provider: "telegram",
    botToken: "telegram-bot-token",
    publicBaseUrl: "http://localhost:4173",
  });
  assert.equal(connection.botUsername, "rocky_test_bot");
  assert.equal(await fileExists(connectionPath), true);
});

test("AgentMessengerService can deliver single-task results to a configured Telegram chat", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-messenger-"));
  const { service: sessionService } = buildSessionServiceStub();
  const fetchCalls: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  const messenger = new AgentMessengerService({
    stateRoot,
    sessionService,
    now: () => "2026-04-08T00:00:00.000Z",
    fetchImpl: async (input, init) => {
      const url = String(input);
      let body: Record<string, unknown> | null = null;
      if (typeof init?.body === "string") {
        body = JSON.parse(init.body);
      }
      fetchCalls.push({ url, body });

      if (url.endsWith("/getMe") || url.endsWith("/deleteWebhook") || url.endsWith("/sendMessage")) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: true,
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          }
        );
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    },
  });

  await messenger.upsertTelegramConnection({
    agentId: "agent-1",
    provider: "telegram",
    publicBaseUrl: "http://localhost:4173",
    botToken: "telegram-bot-token",
  });

  await messenger.deliverTaskResult({
    agentId: "agent-1",
    taskName: "Daily summary",
    sessionId: "session-42",
    runId: "run-42",
    status: "completed",
    chatId: "3001",
    threadId: "77",
    lastMessage: "요약이 완료되었습니다.",
    errors: [],
    stderr: [],
  });

  const sendMessageCall = fetchCalls.find((call) => call.url.endsWith("/sendMessage"));
  assert.ok(sendMessageCall);
  assert.equal(sendMessageCall.body?.chat_id, "3001");
  assert.equal(sendMessageCall.body?.message_thread_id, 77);
  assert.match(String(sendMessageCall.body?.text ?? ""), /Daily summary/);
  assert.match(String(sendMessageCall.body?.text ?? ""), /session-42/);

  const slots = await messenger.listAgentMessengerSlots("agent-1");
  assert.equal(slots[0]?.connection?.lastRunId, "run-42");
  assert.equal(slots[0]?.connection?.lastSessionId, "session-42");
});
