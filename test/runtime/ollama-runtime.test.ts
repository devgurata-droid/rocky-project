import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { OllamaRuntime } from "../../src/runtime/ollama-runtime.js";

import type {
  RuntimeChildProcess,
  RuntimeEvent,
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

async function collectEvents(runtime: OllamaRuntime, runId: string): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  for await (const event of runtime.streamEvents(runId)) {
    events.push(event);
  }
  return events;
}

async function createRuntimeFixture(): Promise<{
  rootDir: string;
  sharedHome: string;
  workspaceRoot: string;
  runtimeHome: string;
}> {
  const rootDir = await mkdtemp(path.join(tmpdir(), "ollama-runtime-test-"));
  const sharedHome = path.join(rootDir, "shared-home");
  const workspaceRoot = path.join(rootDir, "workspace");
  const runtimeHome = path.join(rootDir, "runtime-home");
  await mkdir(sharedHome, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(runtimeHome, { recursive: true });
  return {
    rootDir,
    sharedHome,
    workspaceRoot,
    runtimeHome,
  };
}

test("OllamaRuntime runs Codex through a local Ollama profile", async () => {
  const fixture = await createRuntimeFixture();
  const child = createFakeChild();
  const spawnCalls: Array<{ command: string; args: string[] }> = [];
  const runtime = new OllamaRuntime({
    spawn: (command, args) => {
      spawnCalls.push({ command, args });
      return child;
    },
    catalog: {
      async listInstalledModels() {
        return ["gpt-oss:20b"];
      },
      async buildRuntimeDescriptor() {
        throw new Error("Not needed in this test.");
      },
      resolveBaseUrl() {
        return "http://127.0.0.1:11434";
      },
    } as never,
    now: () => "2026-04-08T00:00:00.000Z",
    idGenerator: (() => {
      let counter = 0;
      return () => `id-${++counter}`;
    })(),
    baseEnv: {
      ...process.env,
      HOME: fixture.runtimeHome,
      PATH: process.env.PATH ?? "",
    },
  });

  const session = await runtime.createSession({
    id: "session-1",
    runtimeKind: "ollama",
    workspaceRoot: fixture.workspaceRoot,
    runtimeHome: fixture.runtimeHome,
    codexBin: "ollama",
    sandbox: "workspace-write",
    approval: "never",
    model: "gpt-oss:20b",
    ollamaLaunchTarget: "codex",
  });

  const start = await runtime.sendTurn({
    sessionId: session.id,
    prompt: "Reply with exactly OK",
  });

  assert.equal(start.command, "codex");
  assert.deepEqual(spawnCalls[0]?.args.slice(0, 11), [
    "--ask-for-approval",
    "never",
    "exec",
    "-C",
    fixture.workspaceRoot,
    "--profile",
    "ollama-launch",
    "--model",
    "gpt-oss:20b",
    "--sandbox",
    "workspace-write",
  ]);
  assert.ok(spawnCalls[0]?.args.includes("exec"));
  assert.equal(spawnCalls[0]?.args.at(-1), "Reply with exactly OK");
  const config = await readFile(
    path.join(fixture.runtimeHome, ".codex", "config.toml"),
    "utf8"
  );
  assert.match(config, /\[profiles\.ollama-launch\]/);
  assert.match(config, /\[model_providers\.ollama-launch\]/);

  child.stdout.end();
  child.stderr.end();
  child.emit("close", 0, null);

  const result = await runtime.getRunResult(start.runId);
  assert.equal(result.status, "completed");

  await rm(fixture.rootDir, { recursive: true, force: true });
});

test("OllamaRuntime mirrors the codex profile into XDG config roots when writable runs share HOME", async () => {
  const fixture = await createRuntimeFixture();
  const child = createFakeChild();
  const runtime = new OllamaRuntime({
    spawn: () => child,
    catalog: {
      async listInstalledModels() {
        return ["gemma4:31b-cloud"];
      },
      async buildRuntimeDescriptor() {
        throw new Error("Not needed in this test.");
      },
      resolveBaseUrl() {
        return "http://127.0.0.1:11434";
      },
    } as never,
    now: () => "2026-04-08T02:00:00.000Z",
    idGenerator: (() => {
      let counter = 0;
      return () => `id-${++counter}`;
    })(),
    baseEnv: {
      ...process.env,
      HOME: fixture.sharedHome,
      PATH: process.env.PATH ?? "",
    },
  });

  const session = await runtime.createSession({
    id: "session-3",
    runtimeKind: "ollama",
    workspaceRoot: fixture.workspaceRoot,
    runtimeHome: fixture.runtimeHome,
    codexBin: "ollama",
    sandbox: "workspace-write",
    approval: "never",
    model: "gemma4:31b-cloud",
    ollamaLaunchTarget: "codex",
  });

  const start = await runtime.sendTurn({
    sessionId: session.id,
    prompt: "Reply with exactly OK",
  });

  child.stdout.end();
  child.stderr.end();
  child.emit("close", 0, null);
  await runtime.getRunResult(start.runId);

  for (const configPath of [
    path.join(fixture.sharedHome, ".codex", "config.toml"),
    path.join(fixture.runtimeHome, "xdg-config", "codex", "config.toml"),
    path.join(fixture.runtimeHome, "xdg-config", ".codex", "config.toml"),
  ]) {
    const config = await readFile(configPath, "utf8");
    assert.match(config, /\[profiles\.ollama-launch\]/);
    assert.match(config, /\[model_providers\.ollama-launch\]/);
  }

  await rm(fixture.rootDir, { recursive: true, force: true });
});

test("OllamaRuntime resumes Codex runs with Ollama provider overrides", async () => {
  const fixture = await createRuntimeFixture();
  const child = createFakeChild();
  const spawnCalls: Array<{ command: string; args: string[] }> = [];
  const runtime = new OllamaRuntime({
    spawn: (command, args) => {
      spawnCalls.push({ command, args });
      return child;
    },
    catalog: {
      async listInstalledModels() {
        return ["gemma4:31b-cloud"];
      },
      async buildRuntimeDescriptor() {
        throw new Error("Not needed in this test.");
      },
      resolveBaseUrl() {
        return "http://127.0.0.1:11434";
      },
    } as never,
    now: () => "2026-04-08T03:00:00.000Z",
    idGenerator: (() => {
      let counter = 0;
      return () => `id-${++counter}`;
    })(),
    baseEnv: {
      ...process.env,
      HOME: fixture.runtimeHome,
      PATH: process.env.PATH ?? "",
    },
  });

  const session = await runtime.createSession({
    id: "session-4",
    runtimeKind: "ollama",
    workspaceRoot: fixture.workspaceRoot,
    runtimeHome: fixture.runtimeHome,
    codexBin: "ollama",
    sandbox: "workspace-write",
    approval: "never",
    model: "gemma4:31b-cloud",
    ollamaLaunchTarget: "codex",
  });
  session.runtimeSessionId = "thread-456";

  const start = await runtime.resumeSession({
    sessionId: session.id,
    prompt: "continue",
  });

  assert.equal(start.command, "codex");
  assert.deepEqual(spawnCalls[0]?.args.slice(0, 10), [
    "--ask-for-approval",
    "never",
    "exec",
    "resume",
    "--model",
    "gemma4:31b-cloud",
    "-c",
    'model_provider="ollama-launch"',
    "--json",
    "--skip-git-repo-check",
  ]);
  assert.ok(!spawnCalls[0]?.args.includes("--profile"));
  assert.ok(!spawnCalls[0]?.args.includes("--sandbox"));
  assert.ok(!spawnCalls[0]?.args.includes("--add-dir"));
  assert.equal(spawnCalls[0]?.args.at(-2), "thread-456");
  assert.equal(spawnCalls[0]?.args.at(-1), "continue");

  child.stdout.end();
  child.stderr.end();
  child.emit("close", 0, null);

  await runtime.getRunResult(start.runId);
  await rm(fixture.rootDir, { recursive: true, force: true });
});

test("OllamaRuntime wraps Claude runs through `ollama launch claude` and keeps stream events", async () => {
  const fixture = await createRuntimeFixture();
  const child = createFakeChild();
  const spawnCalls: Array<{ command: string; args: string[] }> = [];
  const runtime = new OllamaRuntime({
    spawn: (command, args) => {
      spawnCalls.push({ command, args });
      return child;
    },
    catalog: {
      async listInstalledModels() {
        return ["qwen3-coder"];
      },
      async buildRuntimeDescriptor() {
        throw new Error("Not needed in this test.");
      },
      resolveBaseUrl() {
        return "http://127.0.0.1:11434";
      },
    } as never,
    now: () => "2026-04-08T01:00:00.000Z",
    idGenerator: (() => {
      let counter = 0;
      return () => `id-${++counter}`;
    })(),
    baseEnv: {
      ...process.env,
      HOME: fixture.runtimeHome,
      PATH: process.env.PATH ?? "",
    },
  });

  const session = await runtime.createSession({
    id: "session-2",
    runtimeKind: "ollama",
    workspaceRoot: fixture.workspaceRoot,
    runtimeHome: fixture.runtimeHome,
    codexBin: "ollama",
    model: "qwen3-coder",
    ollamaLaunchTarget: "claude",
  });

  const start = await runtime.sendTurn({
    sessionId: session.id,
    prompt: "Reply with exactly HI",
  });
  const eventsPromise = collectEvents(runtime, start.runId);

  assert.deepEqual(spawnCalls[0]?.args.slice(0, 6), [
    "launch",
    "claude",
    "--model",
    "qwen3-coder",
    "--yes",
    "--",
  ]);

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
  assert.equal(events.filter((event) => event.type === "assistant.message.delta").length, 1);
  assert.equal(
    events.find((event) => event.type === "assistant.message.completed")?.data.text,
    "HI"
  );

  const result = await runtime.getRunResult(start.runId);
  assert.equal(result.status, "completed");
  assert.equal(result.runtimeSessionId, "claude-session-1");
  assert.equal(result.lastMessage, "HI");

  await rm(fixture.rootDir, { recursive: true, force: true });
});
