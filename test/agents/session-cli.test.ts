import test from "node:test";
import assert from "node:assert/strict";

import { runAgentCli } from "../../src/cli.js";

import type {
  AgentRunRecord,
  AgentSessionMessage,
  AgentSessionRecord,
} from "../../src/sessions/session-types.js";
import type {
  RuntimeEvent,
  RuntimeRunResult,
} from "../../src/runtime/runtime-types.js";

function createBufferStream(): { write(chunk: string): void; toString(): string } {
  let output = "";

  return {
    write(chunk: string) {
      output += chunk;
    },
    toString() {
      return output;
    },
  };
}

test("session and run CLI commands expose the session service flow", async () => {
  const stdout = createBufferStream();
  const stderr = createBufferStream();
  const calls: string[] = [];
  const baseSession: AgentSessionRecord = {
    id: "session-1",
    agentId: "agent-1",
    kind: "task-request",
    runtimeKind: "codex-cli",
    runtimeSessionId: "thread-1",
    authProfileId: null,
    title: "hello",
    status: "active",
    lifecycle: "active",
    archivedAt: null,
    workspaceRoot: "/tmp/workspace",
    runtimeHome: "/tmp/runtime-home",
    runtimeConfig: {
      codexBin: "codex",
      sandbox: "read-only",
      approval: "never",
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
    createdAt: "2026-03-13T00:00:00.000Z",
    lastActivityAt: "2026-03-13T00:01:00.000Z",
  };
  const baseRun: AgentRunRecord = {
    id: "run-1",
    agentId: "agent-1",
    sessionId: "session-1",
    runtimeRunId: "run-1",
    triggerType: "interactive",
    status: "running",
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    prompt: "analyze this",
    startedAt: "2026-03-13T00:02:00.000Z",
    endedAt: null,
    summary: null,
    runtimeSessionId: "thread-1",
    outputLastMessagePath: "/tmp/last.txt",
    resultPath: "/tmp/result.json",
    eventsPath: "/tmp/events.jsonl",
    artifactsDir: "/tmp/artifacts",
  };
  const result: RuntimeRunResult = {
    runId: "run-1",
    sessionId: "session-1",
    runtimeSessionId: "thread-1",
    sessionBinding: {
      runtimeSessionId: "thread-1",
      boundAt: "2026-03-13T00:02:00.000Z",
      source: "existing-session",
    },
    status: "completed",
    startedAt: "2026-03-13T00:02:00.000Z",
    endedAt: "2026-03-13T00:02:05.000Z",
    exitCode: 0,
    signal: null,
    command: "codex",
    args: ["resume", "hello"],
    messages: [],
    warnings: [],
    errors: [],
    stderr: [],
    artifactRefs: [],
    lastMessage: "done",
    outputLastMessagePath: "/tmp/last.txt",
    rawEvents: [],
  };
  const transcript: AgentSessionMessage[] = [
    {
      id: "run-1:user",
      sessionId: "session-1",
      runId: "run-1",
      role: "user",
      content: "analyze this",
      source: "user-turn",
      createdAt: "2026-03-13T00:02:00.000Z",
    },
    {
      id: "run-1:assistant:1",
      sessionId: "session-1",
      runId: "run-1",
      role: "assistant",
      content: "done",
      source: "message.completed",
      createdAt: "2026-03-13T00:02:05.000Z",
    },
  ];
  const events: RuntimeEvent[] = [
    {
      source: "fake-runtime",
      type: "assistant.message.completed",
      runId: "run-1",
      sessionId: "session-1",
      runtimeSessionId: "thread-1",
      rawType: "message.completed",
      occurredAt: "2026-03-13T00:02:01.000Z",
      data: { text: "partial" },
      raw: { text: "partial" },
    },
    {
      source: "fake-runtime",
      type: "run.completed",
      runId: "run-1",
      sessionId: "session-1",
      runtimeSessionId: "thread-1",
      rawType: "process.close",
      occurredAt: "2026-03-13T00:02:05.000Z",
      data: { status: "completed", exitCode: 0, signal: null },
      raw: { exitCode: 0, signal: null },
    },
  ];
  const fakeSessionService = {
    async createSession(input: { agentId: string; title?: string | null }) {
      calls.push(`create:${input.agentId}:${input.title ?? ""}`);
      return {
        ...baseSession,
        agentId: input.agentId,
        runtimeSessionId: null,
        title: input.title ?? null,
        lastActivityAt: "2026-03-13T00:00:00.000Z",
      };
    },
    async listAgentSessions(agentId: string) {
      calls.push(`list:${agentId}`);
      return [baseSession];
    },
    async getSession(sessionId: string) {
      calls.push(`get:${sessionId}`);
      return {
        ...baseSession,
        id: sessionId,
      };
    },
    async updateSession(input: {
      sessionId: string;
      title?: string | null;
      lifecycle?: "active" | "archived";
    }) {
      calls.push(`update:${input.sessionId}`);
      return {
        ...baseSession,
        id: input.sessionId,
        title:
          Object.prototype.hasOwnProperty.call(input, "title")
            ? input.title ?? null
            : baseSession.title,
        lifecycle: input.lifecycle ?? baseSession.lifecycle,
        archivedAt:
          input.lifecycle === "archived" ? "2026-03-13T00:03:00.000Z" : baseSession.archivedAt,
      };
    },
    async deleteSession(sessionId: string) {
      calls.push(`delete:${sessionId}`);
    },
    async stopSessionRuns(sessionId: string) {
      calls.push(`stop-session-runs:${sessionId}`);
      return [];
    },
    async getTranscript(sessionId: string) {
      calls.push(`transcript:${sessionId}`);
      return transcript;
    },
    async sendTurn(input: { sessionId: string; prompt: string }) {
      calls.push(`send:${input.sessionId}:${input.prompt}`);
      return {
        ...baseRun,
        sessionId: input.sessionId,
        prompt: input.prompt,
      };
    },
    async *streamRunEvents(runId: string) {
      calls.push(`events:${runId}`);
      for (const event of events) {
        yield event;
      }
    },
    async getRun(runId: string) {
      calls.push(`run:${runId}`);
      return baseRun;
    },
    async cancelRun(runId: string) {
      calls.push(`cancel:${runId}`);
    },
    async stopAgentRuns(agentId: string) {
      calls.push(`stop-agent-runs:${agentId}`);
      return [];
    },
    async getRunResult(runId: string) {
      calls.push(`result:${runId}`);
      return {
        ...result,
        runId,
      };
    },
  };

  const createExitCode = await runAgentCli(
    ["session", "create", "agent-1", "--title", "hello"],
    {
      stdout,
      stderr,
      sessionService: fakeSessionService,
    }
  );

  assert.equal(createExitCode, 0);
  assert.equal(JSON.parse(stdout.toString()).id, "session-1");

  const listStdout = createBufferStream();
  const listExitCode = await runAgentCli(
    ["session", "list", "agent-1"],
    {
      stdout: listStdout,
      stderr: createBufferStream(),
      sessionService: fakeSessionService,
    }
  );

  assert.equal(listExitCode, 0);
  assert.equal(JSON.parse(listStdout.toString()).length, 1);

  const getStdout = createBufferStream();
  const getExitCode = await runAgentCli(
    ["session", "get", "session-1"],
    {
      stdout: getStdout,
      stderr: createBufferStream(),
      sessionService: fakeSessionService,
    }
  );

  assert.equal(getExitCode, 0);
  assert.equal(JSON.parse(getStdout.toString()).runtimeSessionId, "thread-1");

  const transcriptStdout = createBufferStream();
  const transcriptExitCode = await runAgentCli(
    ["session", "transcript", "session-1"],
    {
      stdout: transcriptStdout,
      stderr: createBufferStream(),
      sessionService: fakeSessionService,
    }
  );

  assert.equal(transcriptExitCode, 0);
  assert.equal(JSON.parse(transcriptStdout.toString())[1].content, "done");

  const sendStdout = createBufferStream();
  const sendExitCode = await runAgentCli(
    ["session", "send", "session-1", "--prompt", "analyze this"],
    {
      stdout: sendStdout,
      stderr: createBufferStream(),
      sessionService: fakeSessionService,
    }
  );

  assert.equal(sendExitCode, 0);
  assert.equal(JSON.parse(sendStdout.toString()).result.status, "completed");

  const streamStdout = createBufferStream();
  const streamExitCode = await runAgentCli(
    ["session", "send", "session-1", "--prompt", "analyze this", "--stream"],
    {
      stdout: streamStdout,
      stderr: createBufferStream(),
      sessionService: fakeSessionService,
    }
  );

  assert.equal(streamExitCode, 0);
  assert.deepEqual(
    streamStdout
      .toString()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).type),
    ["event", "event", "result"]
  );

  const runStdout = createBufferStream();
  const runExitCode = await runAgentCli(
    ["run", "get", "run-1"],
    {
      stdout: runStdout,
      stderr: createBufferStream(),
      sessionService: fakeSessionService,
    }
  );

  assert.equal(runExitCode, 0);
  assert.equal(JSON.parse(runStdout.toString()).id, "run-1");

  const eventsStdout = createBufferStream();
  const eventsExitCode = await runAgentCli(
    ["run", "events", "run-1"],
    {
      stdout: eventsStdout,
      stderr: createBufferStream(),
      sessionService: fakeSessionService,
    }
  );

  assert.equal(eventsExitCode, 0);
  assert.deepEqual(
    eventsStdout
      .toString()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).type),
    ["assistant.message.completed", "run.completed"]
  );

  const cancelStdout = createBufferStream();
  const cancelExitCode = await runAgentCli(
    ["run", "cancel", "run-1"],
    {
      stdout: cancelStdout,
      stderr: createBufferStream(),
      sessionService: fakeSessionService,
    }
  );

  assert.equal(cancelExitCode, 0);
  assert.equal(JSON.parse(cancelStdout.toString()).status, "completed");
  assert.deepEqual(calls, [
    "create:agent-1:hello",
    "list:agent-1",
    "get:session-1",
    "transcript:session-1",
    "send:session-1:analyze this",
    "result:run-1",
    "send:session-1:analyze this",
    "events:run-1",
    "result:run-1",
    "run:run-1",
    "events:run-1",
    "cancel:run-1",
    "result:run-1",
  ]);
});
