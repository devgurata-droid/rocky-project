import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { normalizeCodexEvent } from "../../src/runtime/codex-event-normalizer.js";

const baseContext = {
  runId: "run-1",
  sessionId: "session-1",
  now: () => "2026-03-13T00:00:00.000Z",
};

test("normalizes thread.started into session.bound", () => {
  const event = normalizeCodexEvent(
    { type: "thread.started", thread_id: "thread-123" },
    baseContext
  );

  assert.equal(event.type, "session.bound");
  assert.equal(event.data.runtimeSessionId, "thread-123");
});

test("normalizes reconnect errors into run.warning", () => {
  const event = normalizeCodexEvent(
    {
      type: "error",
      message: "Reconnecting... 2/5 (stream disconnected before completion)",
    },
    baseContext
  );

  assert.equal(event.type, "run.warning");
  assert.equal(event.data.retriable, true);
});

test("normalizes completed error items into run.warning", () => {
  const event = normalizeCodexEvent(
    {
      type: "item.completed",
      item: {
        type: "error",
        message: "Falling back from WebSockets to HTTPS transport.",
      },
    },
    baseContext
  );

  assert.equal(event.type, "run.warning");
  assert.match(String(event.data.message), /Falling back/);
});

test("keeps unknown events as run.raw", () => {
  const event = normalizeCodexEvent(
    { type: "unrecognized.event", foo: "bar" },
    baseContext
  );

  assert.equal(event.type, "run.raw");
  assert.equal(event.rawType, "unrecognized.event");
});

test("normalizes completed agent messages into assistant.message.completed", () => {
  const event = normalizeCodexEvent(
    {
      type: "item.completed",
      item: {
        type: "agent_message",
        content: [{ text: "analysis summary" }],
      },
    },
    baseContext
  );

  assert.equal(event.type, "assistant.message.completed");
  assert.equal(event.data.text, "analysis summary");
  assert.equal(event.data.itemType, "agent_message");
});

test("normalizes observed codex startup failure fixture into stable event categories", async () => {
  const fixturePath = new URL(
    "./fixtures/codex-cli-startup-failure.jsonl",
    import.meta.url
  );
  const content = await readFile(fixturePath, "utf8");
  const events = content
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .map((event) => normalizeCodexEvent(event, baseContext));

  assert.deepEqual(
    events.map((event) => event.type),
    [
      "session.bound",
      "run.started",
      "run.warning",
      "run.warning",
      "run.warning",
    ]
  );
  assert.equal(events[0]?.data.runtimeSessionId, "019ce441-40b0-75c3-82fc-94ac502fe67f");
});
