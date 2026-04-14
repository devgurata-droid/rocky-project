import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { CodexAccountService } from "../../src/account/codex-account-service.js";

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

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function createJwt(payload: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

test("CodexAccountService reports authenticated status from codex login status", async () => {
  const service = new CodexAccountService({
    codexBin: "codex",
    baseEnv: {
      HOME: "/srv/agent-engine",
    },
    now: () => "2026-03-20T00:00:00.000Z",
    readFile: async () =>
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          id_token: createJwt({
            email: "svc-analyst@example.com",
            name: "Service Analyst",
          }),
          access_token: createJwt({
            "https://api.openai.com/profile": {
              email: "svc-analyst@example.com",
            },
            "https://api.openai.com/auth": {
              chatgpt_plan_type: "plus",
              organizations: [
                {
                  title: "SFA",
                  is_default: true,
                },
              ],
            },
          }),
        },
      }),
    spawn: createSpawn([
      {
        command: "codex",
        args: ["login", "status"],
        run: (child) => {
          (child.stdout as unknown as FakeStream).write("Logged in using ChatGPT\n");
          child.emit("close", 0, null);
        },
      },
    ]),
  });

  const state = await service.getState();

  assert.equal(state.status, "authenticated");
  assert.equal(state.statusText, "Logged in using ChatGPT");
  assert.equal(state.homePath, "/srv/agent-engine");
  assert.equal(state.accountInfo.label, "svc-analyst@example.com");
  assert.equal(state.accountInfo.email, "svc-analyst@example.com");
  assert.equal(state.accountInfo.name, "Service Analyst");
  assert.equal(state.accountInfo.planType, "plus");
  assert.equal(state.accountInfo.organizationTitle, "SFA");
  assert.equal(state.accountInfo.authMode, "chatgpt");
  assert.equal(state.deviceAuth.status, "idle");
});

test("CodexAccountService reports logged-out status from codex login status", async () => {
  const service = new CodexAccountService({
    codexBin: "codex",
    baseEnv: {
      HOME: "/srv/agent-engine",
    },
    now: () => "2026-03-20T00:00:00.000Z",
    spawn: createSpawn([
      {
        command: "codex",
        args: ["login", "status"],
        run: (child) => {
          (child.stdout as unknown as FakeStream).write("Not logged in\n");
          child.emit("close", 0, null);
        },
      },
    ]),
  });

  const state = await service.getState();

  assert.equal(state.status, "logged-out");
  assert.equal(state.statusText, "Not logged in");
  assert.equal(state.accountInfo.label, null);
  assert.equal(state.deviceAuth.status, "idle");
});

test("CodexAccountService tracks device auth output and finishes as authenticated", async () => {
  const timestamps = [
    "2026-03-20T00:00:00.000Z",
    "2026-03-20T00:00:01.000Z",
    "2026-03-20T00:00:02.000Z",
    "2026-03-20T00:00:03.000Z",
    "2026-03-20T00:00:04.000Z",
    "2026-03-20T00:00:05.000Z",
  ];
  const service = new CodexAccountService({
    codexBin: "codex",
    baseEnv: {
      HOME: "/srv/agent-engine",
    },
    now: () => timestamps.shift() ?? "2026-03-20T00:00:59.000Z",
    spawn: createSpawn([
      {
        command: "codex",
        args: ["login", "status"],
        run: (child) => {
          (child.stdout as unknown as FakeStream).write("Not logged in\n");
          child.emit("close", 0, null);
        },
      },
      {
        command: "codex",
        args: ["login", "--device-auth"],
        run: (child) => {
          (child.stdout as unknown as FakeStream).write(
            "Open \u001b[94mhttps://auth.example.test/device\u001b[0m and enter code \u001b[94m6MNN-BF6VG\u001b[0m\n"
          );
          child.emit("close", 0, null);
        },
      },
      {
        command: "codex",
        args: ["login", "status"],
        run: (child) => {
          (child.stdout as unknown as FakeStream).write("Logged in using ChatGPT\n");
          child.emit("close", 0, null);
        },
      },
      {
        command: "codex",
        args: ["login", "status"],
        run: (child) => {
          (child.stdout as unknown as FakeStream).write("Logged in using ChatGPT\n");
          child.emit("close", 0, null);
        },
      },
    ]),
  });

  const pending = await service.startDeviceAuth();
  assert.equal(pending.status, "pending");
  assert.equal(pending.deviceAuth.status, "pending");

  await flushAsyncWork();

  const state = await service.getState();
  assert.equal(state.status, "authenticated");
  assert.equal(state.deviceAuth.status, "completed");
  assert.equal(state.deviceAuth.verificationUri, "https://auth.example.test/device");
  assert.equal(state.deviceAuth.userCode, "6MNN-BF6VG");
  assert.ok(
    state.deviceAuth.output.some((line) => line.includes("6MNN-BF6VG"))
  );
  assert.ok(
    state.deviceAuth.output.every((line) => !line.includes("\u001b["))
  );
});

test("CodexAccountService primary login uses browser login instead of device auth", async () => {
  const service = new CodexAccountService({
    codexBin: "codex",
    baseEnv: {
      HOME: "/srv/agent-engine",
    },
    now: () => "2026-03-20T00:00:00.000Z",
    spawn: createSpawn([
      {
        command: "codex",
        args: ["login", "status"],
        run: (child) => {
          (child.stdout as unknown as FakeStream).write("Not logged in\n");
          child.emit("close", 0, null);
        },
      },
      {
        command: "codex",
        args: ["login"],
        run: (child) => {
          (child.stdout as unknown as FakeStream).write(
            "Browser login started. Complete the OpenAI sign-in flow.\n"
          );
          child.emit("close", 0, null);
        },
      },
      {
        command: "codex",
        args: ["login", "status"],
        run: (child) => {
          (child.stdout as unknown as FakeStream).write("Logged in using ChatGPT\n");
          child.emit("close", 0, null);
        },
      },
      {
        command: "codex",
        args: ["login", "status"],
        run: (child) => {
          (child.stdout as unknown as FakeStream).write("Logged in using ChatGPT\n");
          child.emit("close", 0, null);
        },
      },
    ]),
  });

  const pending = await service.startLogin();
  assert.equal(pending.status, "pending");
  assert.equal(pending.deviceAuth.mode, "browser-login");
  assert.equal(pending.deviceAuth.status, "pending");

  await flushAsyncWork();

  const state = await service.getState();
  assert.equal(state.status, "authenticated");
  assert.equal(state.deviceAuth.mode, "browser-login");
  assert.equal(state.deviceAuth.status, "completed");
});

test("CodexAccountService logout clears pending login and reports logged-out state", async () => {
  const service = new CodexAccountService({
    codexBin: "codex",
    baseEnv: {
      HOME: "/srv/agent-engine",
    },
    now: () => "2026-03-20T00:00:00.000Z",
    spawn: createSpawn([
      {
        command: "codex",
        args: ["login", "status"],
        run: (child) => {
          (child.stdout as unknown as FakeStream).write("Not logged in\n");
          child.emit("close", 0, null);
        },
      },
      {
        command: "codex",
        args: ["login", "--device-auth"],
        run: (_child) => {
          // Keep pending until logout kills the child.
        },
      },
      {
        command: "codex",
        args: ["logout"],
        run: (child) => {
          (child.stdout as unknown as FakeStream).write("Logged out\n");
          child.emit("close", 0, null);
        },
      },
      {
        command: "codex",
        args: ["login", "status"],
        run: (child) => {
          (child.stdout as unknown as FakeStream).write("Not logged in\n");
          child.emit("close", 0, null);
        },
      },
    ]),
  });

  await service.startDeviceAuth();
  const state = await service.logout();

  assert.equal(state.status, "logged-out");
  assert.equal(state.statusText, "Logged out");
  assert.equal(state.accountInfo.label, null);
  assert.equal(state.deviceAuth.status, "idle");
  assert.equal(state.deviceAuth.output.length, 0);
});

test("CodexAccountService logout does not fake logged-out when Codex still reports auth", async () => {
  const service = new CodexAccountService({
    codexBin: "codex",
    baseEnv: {
      HOME: "/srv/agent-engine",
    },
    now: () => "2026-03-20T00:00:00.000Z",
    spawn: createSpawn([
      {
        command: "codex",
        args: ["logout"],
        run: (child) => {
          (child.stdout as unknown as FakeStream).write("Logged out\n");
          child.emit("close", 0, null);
        },
      },
      {
        command: "codex",
        args: ["login", "status"],
        run: (child) => {
          (child.stdout as unknown as FakeStream).write("Logged in using ChatGPT\n");
          child.emit("close", 0, null);
        },
      },
    ]),
  });

  const state = await service.logout();

  assert.equal(state.status, "authenticated");
  assert.equal(
    state.statusText,
    "Codex still reports an authenticated session after logout."
  );
  assert.equal(state.deviceAuth.status, "idle");
});

test("CodexAccountService summarizes a task request title with gpt-5.4-mini", async () => {
  const prompt = "이번 주 경쟁사 3곳의 신규 기능을 비교해서 핵심 차이만 정리해줘";
  const summaryPrompt = [
    "Summarize the user's task request into a short title.",
    "Return only the title text.",
    "Rules:",
    "- Keep the same language as the user request.",
    "- No quotes, markdown, numbering, labels, or trailing punctuation.",
    "- Prefer a concise noun phrase that captures the deliverable or main objective.",
    "- Keep it under 48 characters when possible.",
    "<user_request>",
    prompt,
    "</user_request>",
  ].join("\n");
  const service = new CodexAccountService({
    codexBin: "codex",
    baseEnv: {
      HOME: "/srv/agent-engine",
    },
    spawn: createSpawn([
      {
        command: "codex",
        args: [
          "-C",
          "/srv/agent-engine",
          "--model",
          "gpt-5.4-mini",
          "--sandbox",
          "read-only",
          "--ask-for-approval",
          "never",
          "exec",
          "--json",
          "--color",
          "never",
          "--skip-git-repo-check",
          summaryPrompt,
        ],
        run: (child) => {
          (child.stdout as unknown as FakeStream).write(
            `${JSON.stringify({
              type: "item.completed",
              item: {
                type: "agent_message",
                text: "경쟁사 신규 기능 비교",
              },
            })}\n`
          );
          child.emit("close", 0, null);
        },
      },
    ]),
  });

  const summary = await service.summarizeTaskRequestTitle(prompt);

  assert.deepEqual(summary, {
    title: "경쟁사 신규 기능 비교",
    model: "gpt-5.4-mini",
  });
});
