#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { mkdtemp, rm } from "node:fs/promises";
import { parseArgs } from "node:util";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_FIRST_PROMPT = "Reply with exactly OK and nothing else.";
const DEFAULT_SECOND_PROMPT = "Reply with exactly CONTINUE and nothing else.";
const DEFAULT_HTTP_PROMPT = "Reply with exactly READY and nothing else.";
const DEFAULT_TIMEOUT_MS = 240_000;

function cliPath(): string {
  return path.join(process.cwd(), "dist", "src", "cli.js");
}

function printUsage(): void {
  console.error(`Usage:
  npm run test:e2e:live -- [options]
  node dist/scripts/live-e2e.js [options]

Options:
  --state-root <path>       Reuse a specific state root. Defaults to an auto-cleaned temp directory.
  --host <value>            Host for the spawned HTTP server. Defaults to 127.0.0.1.
  --port <value>            Port for the spawned HTTP server. Defaults to 0.
  --first-prompt <text>     Prompt for the first CLI turn.
  --second-prompt <text>    Prompt for the streamed resume CLI turn.
  --http-prompt <text>      Prompt for the HTTP session turn.
  --timeout-ms <number>     Timeout for CLI commands and HTTP requests. Defaults to 240000.
  --help                    Show this help.
`);
}

function logStep(message: string): void {
  console.error(`\n== ${message}`);
}

async function ensureCodexAvailable(
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<void> {
  try {
    const result = await execFileAsync("codex", ["--version"], {
      cwd: process.cwd(),
      env,
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });
    const version = `${result.stdout}${result.stderr}`.trim();
    console.error(`codex: ${version || "available"}`);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to execute codex from PATH: ${detail}`);
  }
}

async function runCliCommand(
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(process.execPath, [cliPath(), ...args], {
    cwd: process.cwd(),
    env,
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function parseJson<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(
      `${label} did not return valid JSON. Raw output:\n${raw}\n${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function parseNdjson(raw: string, label: string): any[] {
  const lines = raw
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line, index) => parseJson(line, `${label} line ${index + 1}`));
}

function parseSseResponse(payload: string): Array<{ event: string; data: any }> {
  return payload
    .trim()
    .split("\n\n")
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split("\n");
      const event = lines
        .find((line) => line.startsWith("event: "))
        ?.slice("event: ".length);
      const data = lines
        .find((line) => line.startsWith("data: "))
        ?.slice("data: ".length);

      return {
        event: event ?? "",
        data: parseJson(data ?? "{}", "SSE data"),
      };
    });
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs);
  return fetch(url, {
    ...init,
    signal,
  });
}

async function startCliServer(
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<{
  child: ReturnType<typeof spawn>;
  info: { host: string; port: number; stateRoot: string | null };
  stderr: () => string;
}> {
  const child = spawn(process.execPath, [cliPath(), ...args], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  const info = await new Promise<{ host: string; port: number; stateRoot: string | null }>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for serve startup.\n${stderr}`));
      }, timeoutMs);

      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`serve exited before startup: ${code}\n${stderr}`));
      });
      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
        try {
          const parsed = JSON.parse(stdout.trim()) as {
            host: string;
            port: number;
            stateRoot: string | null;
          };
          clearTimeout(timer);
          resolve(parsed);
        } catch {
          // Wait for the full pretty-printed JSON object.
        }
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });
    }
  );

  return {
    child,
    info,
    stderr: () => stderr,
  };
}

async function stopProcess(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

function assertCompletedRun(result: any, label: string): void {
  assert.equal(result.status, "completed", `${label} should complete`);
  assert.ok(
    typeof result.runtimeSessionId === "string" && result.runtimeSessionId.length > 0,
    `${label} should bind a runtimeSessionId`
  );
  assert.ok(result.sessionBinding, `${label} should include sessionBinding`);
  assert.ok(
    (Array.isArray(result.messages) && result.messages.length > 0) ||
      (typeof result.lastMessage === "string" && result.lastMessage.length > 0),
    `${label} should include assistant output`
  );
}

function assertEventTypesInclude(
  eventTypes: string[],
  expected: string[],
  label: string
): void {
  for (const eventType of expected) {
    assert.ok(
      eventTypes.includes(eventType),
      `${label} should include ${eventType}. Saw: ${eventTypes.join(", ")}`
    );
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "state-root": { type: "string" },
      host: { type: "string" },
      port: { type: "string" },
      "first-prompt": { type: "string" },
      "second-prompt": { type: "string" },
      "http-prompt": { type: "string" },
      "timeout-ms": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });

  if (values.help) {
    printUsage();
    return;
  }

  const timeoutMs = values["timeout-ms"] ? Number(values["timeout-ms"]) : DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive integer");
  }

  const tempRoot =
    values["state-root"] === undefined
      ? await mkdtemp(path.join(os.tmpdir(), "agent-engine-live-e2e-"))
      : null;
  const stateRoot = path.resolve(
    values["state-root"] ?? path.join(tempRoot ?? process.cwd(), "state")
  );
  const host = values.host ?? "127.0.0.1";
  const port = values.port ?? "0";
  const firstPrompt = values["first-prompt"] ?? DEFAULT_FIRST_PROMPT;
  const secondPrompt = values["second-prompt"] ?? DEFAULT_SECOND_PROMPT;
  const httpPrompt = values["http-prompt"] ?? DEFAULT_HTTP_PROMPT;
  const agentId = `live-e2e-agent-${Date.now()}`;
  const env = { ...process.env };
  let runError: unknown = null;

  try {
    await ensureCodexAvailable(env, timeoutMs);
    console.error(
      `stateRoot: ${stateRoot}${tempRoot ? " (auto-cleanup on exit)" : " (preserved)"}`
    );

    logStep("Create agent via CLI");
    const createdAgent = parseJson<any>(
      (
        await runCliCommand(
          [
            "agent",
            "create",
            "--state-root",
            stateRoot,
            "--id",
            agentId,
            "--name",
            "Live E2E Agent",
            "--sandbox",
            "read-only",
          ],
          env,
          timeoutMs
        )
      ).stdout,
      "agent create"
    );
    assert.equal(createdAgent.id, agentId);

    logStep("Create session via CLI");
    const createdSession = parseJson<any>(
      (
        await runCliCommand(
          [
            "session",
            "create",
            agentId,
            "--state-root",
            stateRoot,
            "--title",
            "Live E2E Session",
          ],
          env,
          timeoutMs
        )
      ).stdout,
      "session create"
    );
    assert.equal(createdSession.id.length > 0, true);
    assert.equal(createdSession.runtimeConfig.skipGitRepoCheck, true);

    logStep("Run first CLI turn");
    const firstSend = parseJson<any>(
      (
        await runCliCommand(
          [
            "session",
            "send",
            createdSession.id,
            "--state-root",
            stateRoot,
            "--prompt",
            firstPrompt,
          ],
          env,
          timeoutMs
        )
      ).stdout,
      "first session send"
    );
    assertCompletedRun(firstSend.result, "first CLI run");

    logStep("Run streamed resume CLI turn");
    const streamedLines = parseNdjson(
      (
        await runCliCommand(
          [
            "session",
            "send",
            createdSession.id,
            "--state-root",
            stateRoot,
            "--prompt",
            secondPrompt,
            "--stream",
          ],
          env,
          timeoutMs
        )
      ).stdout,
      "streamed session send"
    );
    assert.ok(streamedLines.length >= 2, "streamed CLI run should emit events and a final result");
    assert.equal(streamedLines.at(-1)?.type, "result");
    const streamedEventTypes = streamedLines
      .filter((entry) => entry.type === "event")
      .map((entry) => String(entry.event?.type ?? ""));
    assertEventTypesInclude(streamedEventTypes, ["run.completed"], "streamed CLI events");

    const streamedResult = streamedLines.at(-1)?.result;
    assertCompletedRun(streamedResult, "streamed CLI run");
    assert.equal(
      streamedResult.runtimeSessionId,
      firstSend.result.runtimeSessionId,
      "resume run should keep the same runtimeSessionId"
    );

    logStep("Replay transcript and persisted run events");
    const transcript = parseJson<any[]>(
      (
        await runCliCommand(
          [
            "session",
            "transcript",
            createdSession.id,
            "--state-root",
            stateRoot,
          ],
          env,
          timeoutMs
        )
      ).stdout,
      "session transcript"
    );
    assert.ok(transcript.length >= 4, "transcript should contain at least two user/assistant pairs");
    assert.deepEqual(
      transcript.slice(0, 4).map((message) => message.role),
      ["user", "assistant", "user", "assistant"]
    );
    assert.ok(
      transcript.every(
        (message) => typeof message.content === "string" && message.content.trim().length > 0
      ),
      "transcript entries should contain non-empty content"
    );

    const replayedRunEvents = parseNdjson(
      (
        await runCliCommand(
          [
            "run",
            "events",
            firstSend.run.id,
            "--state-root",
            stateRoot,
          ],
          env,
          timeoutMs
        )
      ).stdout,
      "run events replay"
    );
    assertEventTypesInclude(
      replayedRunEvents.map((event) => String(event.type ?? "")),
      ["run.completed"],
      "persisted run events"
    );

    logStep("Start HTTP server and execute HTTP/SSE flow");
    const { child, info, stderr } = await startCliServer(
      [
        "serve",
        "--state-root",
        stateRoot,
        "--host",
        host,
        "--port",
        port,
      ],
      env,
      timeoutMs
    );

    try {
      const baseUrl = `http://${info.host}:${info.port}`;

      const createdHttpSessionResponse = await fetchWithTimeout(
        `${baseUrl}/agents/${agentId}/sessions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: "Live HTTP Session" }),
        },
        timeoutMs
      );
      assert.equal(createdHttpSessionResponse.status, 201);
      const createdHttpSession = await createdHttpSessionResponse.json();
      assert.ok(createdHttpSession.id);

      const createdHttpRunResponse = await fetchWithTimeout(
        `${baseUrl}/sessions/${createdHttpSession.id}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ prompt: httpPrompt }),
        },
        timeoutMs
      );
      assert.equal(createdHttpRunResponse.status, 202);
      const createdHttpRun = await createdHttpRunResponse.json();
      assert.ok(createdHttpRun.id);

      const sseResponse = await fetchWithTimeout(
        `${baseUrl}/runs/${createdHttpRun.id}/events`,
        {},
        timeoutMs
      );
      assert.equal(sseResponse.status, 200);
      assert.match(sseResponse.headers.get("content-type") ?? "", /^text\/event-stream/);
      const sseEvents = parseSseResponse(await sseResponse.text());
      assertEventTypesInclude(
        sseEvents.map((entry) => entry.event),
        ["run.completed"],
        "HTTP SSE events"
      );

      const httpResultResponse = await fetchWithTimeout(
        `${baseUrl}/runs/${createdHttpRun.id}/result`,
        {},
        timeoutMs
      );
      assert.equal(httpResultResponse.status, 200);
      const httpResult = await httpResultResponse.json();
      assertCompletedRun(httpResult, "HTTP run");

      const httpTranscriptResponse = await fetchWithTimeout(
        `${baseUrl}/sessions/${createdHttpSession.id}/transcript`,
        {},
        timeoutMs
      );
      assert.equal(httpTranscriptResponse.status, 200);
      const httpTranscript = await httpTranscriptResponse.json();
      assert.ok(
        Array.isArray(httpTranscript) && httpTranscript.length >= 2,
        "HTTP transcript should include at least one user/assistant pair"
      );
      assert.deepEqual(
        httpTranscript.slice(0, 2).map((message: any) => message.role),
        ["user", "assistant"]
      );
    } finally {
      await stopProcess(child);
      assert.equal(stderr(), "", "serve should not write to stderr");
    }

    console.error("\nLive e2e completed successfully.");
  } catch (error) {
    runError = error;
    throw error;
  } finally {
    if (tempRoot) {
      try {
        await rm(tempRoot, { recursive: true, force: true });
      } catch (cleanupError) {
        if (runError) {
          console.error(
            `Failed to clean up temp state root ${tempRoot}: ${
              cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
            }`
          );
        } else {
          throw cleanupError;
        }
      }
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
