import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { CliDiagnosticsService } from "../../src/account/cli-diagnostics-service.js";

import type {
  RuntimeChildProcess,
  RuntimeSpawnOptions,
  SpawnLike,
} from "../../src/runtime/runtime-types.js";

class FakeStream extends EventEmitter {
  write(chunk: string): void {
    this.emit("data", Buffer.from(chunk, "utf8"));
  }
}

class FakeChild extends EventEmitter implements RuntimeChildProcess {
  readonly stdout = new FakeStream() as unknown as NodeJS.ReadWriteStream;
  readonly stderr = new FakeStream() as unknown as NodeJS.ReadWriteStream;

  kill(signal?: NodeJS.Signals): void {
    this.emit("close", null, signal ?? "SIGTERM");
  }

  override once(
    event: "error" | "close",
    listener: ((error: Error) => void) | ((exitCode: number | null, signal: NodeJS.Signals | null) => void)
  ): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }
}

interface SpawnScenario {
  command: string;
  args: string[];
  run: (child: FakeChild, options: RuntimeSpawnOptions) => void;
}

function createSpawn(scenarios: SpawnScenario[]): SpawnLike {
  return ((command, args, options) => {
    const scenario = scenarios.shift();
    assert.ok(scenario, `Unexpected spawn: ${command} ${args.join(" ")}`);
    assert.equal(command, scenario.command);
    assert.deepEqual(args, scenario.args);
    const child = new FakeChild();
    queueMicrotask(() => {
      scenario.run(child, options);
    });
    return child;
  }) as SpawnLike;
}

test("CliDiagnosticsService uses Homebrew cask metadata for installed Claude Code", async () => {
  let fallbackCalls = 0;
  const service = new CliDiagnosticsService({
    provider: "claude",
    command: "claude",
    now: () => "2026-04-03T12:00:00.000Z",
    baseEnv: {
      HOME: "/srv/agent-engine",
      PATH: "/opt/homebrew/bin",
    },
    access: async () => undefined,
    latestVersionResolver: async () => {
      fallbackCalls += 1;
      return {
        latestVersion: "9.9.9",
        latestCheckedAt: "2026-04-03T12:00:00.000Z",
        latestSource: "test:fallback",
      };
    },
    spawn: createSpawn([
      {
        command: "claude",
        args: ["--version"],
        run: (child) => {
          (child.stdout as unknown as FakeStream).write("2.1.81 (Claude Code)\n");
          child.emit("close", 0, null);
        },
      },
      {
        command: "brew",
        args: ["info", "--cask", "claude-code"],
        run: (child) => {
          (child.stdout as unknown as FakeStream).write(
            "==> claude-code: 2.1.81\nInstalled\n"
          );
          child.emit("close", 0, null);
        },
      },
    ]),
  });

  const diagnostics = await service.getDiagnostics();

  assert.equal(diagnostics.installMethod, "homebrew-cask");
  assert.equal(diagnostics.currentVersion, "2.1.81");
  assert.equal(diagnostics.latestVersion, "2.1.81");
  assert.equal(diagnostics.latestStatus, "current");
  assert.equal(diagnostics.latestSource, "brew:cask:claude-code");
  assert.equal(fallbackCalls, 0);
});

test("CliDiagnosticsService falls back when Homebrew metadata is unavailable", async () => {
  let fallbackCalls = 0;
  const service = new CliDiagnosticsService({
    provider: "claude",
    command: "claude",
    now: () => "2026-04-03T12:00:00.000Z",
    baseEnv: {
      HOME: "/srv/agent-engine",
      PATH: "/opt/homebrew/bin",
    },
    access: async () => undefined,
    latestVersionResolver: async () => {
      fallbackCalls += 1;
      return {
        latestVersion: "2.1.82",
        latestCheckedAt: "2026-04-03T12:00:00.000Z",
        latestSource: "test:fallback",
      };
    },
    spawn: createSpawn([
      {
        command: "claude",
        args: ["--version"],
        run: (child) => {
          (child.stdout as unknown as FakeStream).write("2.1.81 (Claude Code)\n");
          child.emit("close", 0, null);
        },
      },
      {
        command: "brew",
        args: ["info", "--cask", "claude-code"],
        run: (child) => {
          (child.stderr as unknown as FakeStream).write("Error: unavailable\n");
          child.emit("close", 1, null);
        },
      },
    ]),
  });

  const diagnostics = await service.getDiagnostics();

  assert.equal(diagnostics.installMethod, "homebrew-cask");
  assert.equal(diagnostics.currentVersion, "2.1.81");
  assert.equal(diagnostics.latestVersion, "2.1.82");
  assert.equal(diagnostics.latestStatus, "update-available");
  assert.equal(diagnostics.latestSource, "test:fallback");
  assert.equal(fallbackCalls, 1);
});
