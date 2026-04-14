import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { buildClaudeCodeCommand } from "../../src/runtime/claude-command.js";
import { ClaudeCodeRuntime } from "../../src/runtime/claude-code-runtime.js";

import type {
  RuntimeChildProcess,
  RuntimeEvent,
  RuntimeSession,
} from "../../src/runtime/runtime-types.js";

function createFakeChild(): EventEmitter & RuntimeChildProcess {
  const child = new EventEmitter() as EventEmitter & RuntimeChildProcess;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = (signal = "SIGTERM") => {
    queueMicrotask(() => {
      child.stdout.end();
      child.stderr.end();
      child.emit("close", null, signal);
    });
  };
  return child;
}

function buildSession(): RuntimeSession {
  return {
    id: "session-1",
    agentId: "agent-1",
    runtimeKind: "claude-code",
    runtimeSessionId: null,
    workspaceRoot: "/workspace/app",
    runtimeHome: "/workspace/app/.runtime/claude",
    config: {
      codexBin: "claude",
      sandbox: "workspace-write",
      approval: "on-request",
      profile: null,
      authProfileId: null,
      model: "claude-sonnet-4-6",
      reasoningEffort: null,
      serviceTier: null,
      fullAuto: false,
      dangerouslyBypassApprovalsAndSandbox: false,
      additionalWritableDirs: ["/workspace/shared"],
      configOverrides: [],
      enableFeatures: [],
      disableFeatures: [],
      skipGitRepoCheck: true,
      ephemeral: false,
    },
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
  };
}

async function collectEvents(runtime: ClaudeCodeRuntime, runId: string): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  for await (const event of runtime.streamEvents(runId)) {
    events.push(event);
  }
  return events;
}

test("buildClaudeCodeCommand includes partial message streaming", () => {
  const session = buildSession();
  session.config.reasoningEffort = "max";

  const { command, args } = buildClaudeCodeCommand({
    session,
    request: {
      sessionId: session.id,
      prompt: "Reply with exactly OK",
    },
  });

  assert.equal(command, "claude");
  assert.deepEqual(args.slice(0, 4), [
    "--print",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
  ]);
  assert.equal(args[4], "--verbose");
  assert.ok(args.includes("--model"));
  assert.ok(args.includes("claude-sonnet-4-6"));
  assert.ok(args.includes("--effort"));
  assert.ok(args.includes("max"));
});

test("buildClaudeCodeCommand honors request-level dangerous permission bypass", () => {
  const session = buildSession();

  const { args } = buildClaudeCodeCommand({
    session,
    request: {
      sessionId: session.id,
      prompt: "Run 'npm run login:threads' in the current workspace.",
      dangerouslyBypassApprovalsAndSandbox: true,
    },
  });

  assert.ok(args.includes("--dangerously-skip-permissions"));
  assert.ok(!args.includes("--permission-mode"));
});

test("ClaudeCodeRuntime emits assistant deltas from stream_event content blocks", async () => {
  const child = createFakeChild();
  const runtime = new ClaudeCodeRuntime({
    spawn: () => child,
    now: () => "2026-04-04T01:00:00.000Z",
    idGenerator: (() => {
      let counter = 0;
      return () => `id-${++counter}`;
    })(),
  });

  const session = await runtime.createSession({
    id: "session-1",
    agentId: "agent-1",
    runtimeKind: "claude-code",
    workspaceRoot: "/workspace/app",
    codexBin: "claude",
    model: "claude-sonnet-4-6",
    sandbox: "workspace-write",
    approval: "on-request",
  });

  const start = await runtime.sendTurn({
    sessionId: session.id,
    prompt: "Reply with exactly HI",
  });
  const eventsPromise = collectEvents(runtime, start.runId);

  child.stdout.write(
    `${JSON.stringify({
      type: "system",
      session_id: "claude-session-1",
    })}\n`
  );
  child.stdout.write(
    `${JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: {
          type: "text_delta",
          text: "H",
        },
      },
    })}\n`
  );
  child.stdout.write(
    `${JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: {
          type: "text_delta",
          text: "I",
        },
      },
    })}\n`
  );
  child.stdout.write(
    `${JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "text",
            text: "HI",
          },
        ],
      },
    })}\n`
  );
  child.stdout.end();
  child.stderr.end();
  child.emit("close", 0, null);

  const events = await eventsPromise;
  const deltaEvents = events.filter((event) => event.type === "assistant.message.delta");
  const completedEvents = events.filter(
    (event) => event.type === "assistant.message.completed"
  );

  assert.equal(deltaEvents.length, 2);
  assert.deepEqual(
    deltaEvents.map((event) => event.data.text),
    ["H", "I"]
  );
  assert.equal(completedEvents.length, 1);
  assert.equal(completedEvents[0]?.data.text, "HI");

  const result = await runtime.getRunResult(start.runId);
  assert.equal(result.status, "completed");
  assert.equal(result.runtimeSessionId, "claude-session-1");
  assert.equal(result.lastMessage, "HI");
});
