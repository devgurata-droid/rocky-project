import test from "node:test";
import assert from "node:assert/strict";

import { ClaudeStatusService } from "../../src/account/claude-status-service.js";

import type { ClaudeAccountRecord } from "../../src/account/claude-account-types.js";

function buildClaudeAccountState(
  overrides: Partial<ClaudeAccountRecord> = {}
): ClaudeAccountRecord {
  return {
    provider: "claude",
    providerLabel: "Claude Code",
    status: "authenticated",
    statusText: "Claude Code is authenticated.",
    homePath: "/srv/agent-engine",
    updatedAt: "2026-04-03T00:00:00.000Z",
    claudeBin: "claude",
    accountInfo: {
      label: "claude-user",
      email: "claude@example.com",
      name: "Claude User",
      userId: "claude-user",
      planType: null,
      organizationTitle: null,
      authMode: "claudeai",
    },
    apiProvider: "firstParty",
    loginMethods: [],
    primaryLoginMethodId: "browser-login",
    diagnostics: {
      command: "claude",
      resolvedPath: "/usr/local/bin/claude",
      installStatus: "installed",
      installMethod: "homebrew-cask",
      currentVersion: "2.1.81",
      rawVersionText: "2.1.81 (Claude Code)",
      checkedAt: "2026-04-03T00:00:00.000Z",
      latestVersion: "2.1.81",
      latestStatus: "current",
      latestCheckedAt: "2026-04-03T00:00:00.000Z",
      latestSource: "env",
      statusText: "Claude Code is up to date.",
    },
    update: {
      status: "idle",
      supported: true,
      installMethod: "homebrew-cask",
      commandPreview: "brew upgrade --cask claude-code",
      startedAt: null,
      completedAt: null,
      output: [],
      lastError: null,
    },
    browserAuth: {
      status: "completed",
      mode: "claudeai",
      startedAt: "2026-04-03T00:00:00.000Z",
      completedAt: "2026-04-03T00:01:00.000Z",
      verificationUri: null,
      instructions: null,
      lastError: null,
    },
    ...overrides,
  };
}

function buildAccountService(overrides: Partial<ClaudeAccountRecord> = {}) {
  return {
    async getState() {
      return buildClaudeAccountState(overrides);
    },
    async startBrowserLogin() {
      return buildClaudeAccountState(overrides);
    },
    async startUpdate() {
      return buildClaudeAccountState(overrides);
    },
    async logout() {
      return buildClaudeAccountState({
        ...overrides,
        status: "logged-out",
        statusText: "Claude Code is not logged in.",
      });
    },
  };
}

test("ClaudeStatusService returns stats-cache usage summary when rate limits are unavailable", async () => {
  const service = new ClaudeStatusService({
    accountService: buildAccountService(),
    now: () => "2026-04-03T12:00:00.000Z",
    baseEnv: {
      HOME: "/srv/agent-engine",
    },
    readOauthAccessToken: async () => null,
    readFile: async (filePath) => {
      if (!filePath.endsWith("stats-cache.json")) {
        throw new Error(`Unexpected file read: ${filePath}`);
      }

      return JSON.stringify({
        totalMessages: 184,
        totalSessions: 16,
        lastComputedDate: "2026-04-02",
        modelUsage: {
          "claude-opus-4-1-20250805": {
            inputTokens: 120000,
            outputTokens: 42000,
            cacheReadInputTokens: 5000,
            cacheCreationInputTokens: 3000,
            costUSD: 18.42,
          },
        },
      });
    },
    listProjectLogPaths: async () => [],
  });

  const status = await service.getStatus();

  assert.equal(status.status, "ok");
  assert.equal(status.fiveHour.remainingPercent, null);
  assert.equal(status.weekly.remainingPercent, null);
  assert.equal(status.usageSummary?.totalMessages, 184);
  assert.equal(status.usageSummary?.totalSessions, 16);
  assert.equal(status.usageSummary?.totalTokens, 170000);
  assert.equal(status.usageSummary?.totalCostUsd, 18.42);
  assert.equal(status.model, "claude-opus-4-1-20250805");
  assert.equal(status.statusText, "Claude usage summary loaded from local stats cache.");
});

test("ClaudeStatusService prefers newest rate-limit snapshot when available", async () => {
  const files = new Map<string, string>([
    [
      "/srv/agent-engine/.claude/stats-cache.json",
      JSON.stringify({
        totalMessages: 184,
        totalSessions: 16,
        lastComputedDate: "2026-04-02",
        modelUsage: {
          "claude-opus-4-1-20250805": {
            inputTokens: 120000,
            outputTokens: 42000,
            cacheReadInputTokens: 5000,
            cacheCreationInputTokens: 3000,
            costUSD: 18.42,
          },
        },
      }),
    ],
    [
      "/srv/agent-engine/.claude/projects/a/session.jsonl",
      [
        '{"timestamp":"2026-04-03T11:30:00.000Z","rate_limits":{"five_hour":{"used_percentage":28,"resets_at":1775217600},"seven_day":{"used_percentage":43,"resets_at":1775769600}}}',
      ].join("\n"),
    ],
  ]);

  const service = new ClaudeStatusService({
    accountService: buildAccountService(),
    now: () => "2026-04-03T11:45:00.000Z",
    baseEnv: {
      HOME: "/srv/agent-engine",
    },
    readOauthAccessToken: async () => null,
    readFile: async (filePath) => {
      const content = files.get(filePath);
      assert.ok(content, `Unexpected file read: ${filePath}`);
      return content;
    },
    listProjectLogPaths: async () => ["/srv/agent-engine/.claude/projects/a/session.jsonl"],
  });

  const status = await service.getStatus();

  assert.equal(status.status, "ok");
  assert.equal(status.fiveHour.remainingPercent, 72);
  assert.equal(status.weekly.remainingPercent, 57);
  assert.equal(status.fiveHour.status, "ok");
  assert.equal(status.weekly.status, "ok");
  assert.equal(status.refreshedAt, "2026-04-03T11:30:00.000Z");
  assert.equal(status.statusText, "Claude rate-limit snapshot is current.");
});

test("ClaudeStatusService reads rate-limit snapshots from runtime run results", async () => {
  const files = new Map<string, string>([
    [
      "/srv/agent-engine/.runtime/agent-engine/agents/claude-agent/runs/run-1/result.json",
      JSON.stringify({
        startedAt: "2026-04-03T11:29:00.000Z",
        endedAt: "2026-04-03T11:30:00.000Z",
        rawEvents: [
          {
            type: "rate_limit_event",
            rate_limit_info: {
              rateLimitType: "five_hour",
              utilization: 0.28,
              resetsAt: 1775217600,
            },
          },
          {
            type: "rate_limit_event",
            rate_limit_info: {
              rateLimitType: "seven_day",
              utilization: 0.43,
              resetsAt: 1775769600,
            },
          },
        ],
      }),
    ],
  ]);

  const service = new ClaudeStatusService({
    accountService: buildAccountService(),
    now: () => "2026-04-03T11:45:00.000Z",
    stateRoot: "/srv/agent-engine/.runtime/agent-engine",
    baseEnv: {
      HOME: "/srv/agent-engine",
    },
    readOauthAccessToken: async () => null,
    readFile: async (filePath) => {
      const content = files.get(filePath);
      assert.ok(content, `Unexpected file read: ${filePath}`);
      return content;
    },
    listProjectLogPaths: async () => [],
    listRunResultPaths: async () => [
      "/srv/agent-engine/.runtime/agent-engine/agents/claude-agent/runs/run-1/result.json",
    ],
  });

  const status = await service.getStatus();

  assert.equal(status.status, "ok");
  assert.equal(status.fiveHour.remainingPercent, 72);
  assert.equal(status.weekly.remainingPercent, 57);
  assert.equal(status.fiveHour.status, "ok");
  assert.equal(status.weekly.status, "ok");
  assert.equal(status.refreshedAt, "2026-04-03T11:30:00.000Z");
  assert.equal(status.statusText, "Claude rate-limit snapshot is current.");
});

test("ClaudeStatusService explains when Claude omits usage percentages in runtime events", async () => {
  const files = new Map<string, string>([
    [
      "/srv/agent-engine/.runtime/agent-engine/agents/claude-agent/runs/run-1/result.json",
      JSON.stringify({
        startedAt: "2026-04-03T11:29:00.000Z",
        endedAt: "2026-04-03T11:30:00.000Z",
        rawEvents: [
          {
            type: "rate_limit_event",
            rate_limit_info: {
              rateLimitType: "five_hour",
              resetsAt: 1775217600,
            },
          },
        ],
      }),
    ],
  ]);

  const service = new ClaudeStatusService({
    accountService: buildAccountService(),
    now: () => "2026-04-03T11:45:00.000Z",
    stateRoot: "/srv/agent-engine/.runtime/agent-engine",
    baseEnv: {
      HOME: "/srv/agent-engine",
    },
    readOauthAccessToken: async () => null,
    readFile: async (filePath) => {
      const content = files.get(filePath);
      assert.ok(content, `Unexpected file read: ${filePath}`);
      return content;
    },
    listProjectLogPaths: async () => [],
    listRunResultPaths: async () => [
      "/srv/agent-engine/.runtime/agent-engine/agents/claude-agent/runs/run-1/result.json",
    ],
  });

  const status = await service.getStatus();

  assert.equal(status.status, "unavailable");
  assert.equal(status.fiveHour.status, "ok");
  assert.equal(status.fiveHour.remainingPercent, null);
  assert.equal(status.fiveHour.resetAt, "2026-04-03T20:00:00.000Z");
  assert.equal(
    status.statusText,
    "Claude Code emitted reset metadata, but this CLI version did not expose usage percentages in non-interactive mode."
  );
});

test("ClaudeStatusService prefers OAuth usage when a Claude first-party token is available", async () => {
  const service = new ClaudeStatusService({
    accountService: buildAccountService(),
    now: () => "2026-04-04T00:00:00.000Z",
    baseEnv: {
      HOME: "/srv/agent-engine",
    },
    readOauthAccessToken: async () => "oauth-token",
    fetch: async (input, init) => {
      assert.equal(String(input), "https://api.anthropic.com/api/oauth/usage");
      assert.deepEqual(init?.headers, {
        Authorization: "Bearer oauth-token",
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "claude-code/2.1.81",
      });
      return {
        headers: {
          get() {
            return null;
          },
        },
        ok: true,
        status: 200,
        async json() {
          return {
            five_hour: {
              utilization: 0,
              resets_at: null,
            },
            seven_day: {
              utilization: 7,
              resets_at: "2026-04-06T12:00:00.572939+00:00",
            },
          };
        },
      };
    },
    readFile: async () => {
      throw new Error("stats cache should not be read");
    },
    listProjectLogPaths: async () => [],
    listRunResultPaths: async () => [],
  });

  const status = await service.getStatus();

  assert.equal(status.status, "ok");
  assert.equal(status.fiveHour.remainingPercent, 100);
  assert.equal(status.weekly.remainingPercent, 93);
  assert.equal(status.refreshedAt, "2026-04-04T00:00:00.000Z");
  assert.equal(status.statusText, "Claude usage loaded from OAuth usage API.");
});

test("ClaudeStatusService reuses cached OAuth usage when the API is rate limited", async () => {
  const cachePath = "/srv/agent-engine/.runtime/agent-engine/account/claude-oauth-usage.json";
  const writes: Array<{ filePath: string; content: string }> = [];
  const service = new ClaudeStatusService({
    accountService: buildAccountService(),
    now: () => "2026-04-04T00:10:00.000Z",
    stateRoot: "/srv/agent-engine/.runtime/agent-engine",
    baseEnv: {
      HOME: "/srv/agent-engine",
    },
    readOauthAccessToken: async () => "oauth-token",
    readFile: async (filePath) => {
      if (filePath === cachePath) {
        return JSON.stringify({
          refreshedAt: "2026-04-04T00:00:00.000Z",
          nextAttemptAt: null,
          fiveHour: {
            refreshedAt: "2026-04-04T00:00:00.000Z",
            windowMinutes: 300,
            usedPercent: 0,
            remainingPercent: 100,
            resetAt: null,
          },
          weekly: {
            refreshedAt: "2026-04-04T00:00:00.000Z",
            windowMinutes: 10080,
            usedPercent: 7,
            remainingPercent: 93,
            resetAt: "2026-04-06T12:00:00.572939+00:00",
          },
        });
      }

      throw new Error(`Unexpected file read: ${filePath}`);
    },
    fetch: async () => ({
      headers: {
        get(name: string) {
          return name === "retry-after" ? "3600" : null;
        },
      },
      ok: false,
      status: 429,
      async json() {
        return {};
      },
    }),
    mkdir: async () => undefined,
    writeFile: async (filePath, content) => {
      writes.push({
        filePath,
        content,
      });
    },
    listProjectLogPaths: async () => [],
    listRunResultPaths: async () => [],
  });

  const status = await service.getStatus();

  assert.equal(status.fiveHour.remainingPercent, 100);
  assert.equal(status.weekly.remainingPercent, 93);
  assert.equal(status.weekly.resetAt, "2026-04-06T12:00:00.572Z");
  assert.equal(status.statusText, "Claude usage loaded from OAuth usage API.");
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.filePath, cachePath);
  assert.match(writes[0]?.content ?? "", /"nextAttemptAt": "2026-04-04T01:10:00.000Z"/);
});
