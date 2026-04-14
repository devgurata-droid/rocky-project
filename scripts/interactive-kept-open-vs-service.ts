#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_ITERATIONS = 2;
const DEFAULT_TIMEOUT_MS = 240_000;
const POLL_INTERVAL_MS = 300;

interface VisibleSample {
  iteration: number;
  visibleMs: number;
}

interface ServiceSample extends VisibleSample {
  commandDurationMs: number;
}

interface SummaryStats {
  count: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
}

function cliPath(): string {
  return path.join(process.cwd(), "dist", "src", "cli.js");
}

function printUsage(): void {
  console.error(`Usage:
  npm run benchmark:interactive-kept-open -- [options]
  node dist/scripts/interactive-kept-open-vs-service.js [options]

Options:
  --iterations <number>     Number of repeated warm-turn comparisons. Defaults to 2.
  --timeout-ms <number>     Timeout per iteration. Defaults to 240000.
  --output <path>           Write the benchmark JSON result to a file.
  --help                    Show this help.
`);
}

function logStep(message: string): void {
  console.error(`\n== ${message}`);
}

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1)
  );
  return sorted[index];
}

function summarize(values: number[]): SummaryStats {
  assert.ok(values.length > 0, "summary requires at least one value");
  return {
    count: values.length,
    minMs: Math.min(...values),
    maxMs: Math.max(...values),
    avgMs: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
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
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line, index) =>
    parseJson(line, `${label} line ${index + 1}`)
  );
}

async function ensureCodexAvailable(
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<void> {
  const result = await execFileAsync("codex", ["--version"], {
    cwd: process.cwd(),
    env,
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
  const version = `${result.stdout}${result.stderr}`.trim();
  console.error(`codex: ${version || "available"}`);
}

async function runCliJsonCommand(
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<any> {
  const result = await execFileAsync(process.execPath, [cliPath(), ...args], {
    cwd: process.cwd(),
    env,
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
  return parseJson(result.stdout, `CLI ${args.join(" ")}`);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function tmuxCommand(
  socketPath: string,
  args: string[],
  timeoutMs: number
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("tmux", ["-S", socketPath, ...args], {
    cwd: process.cwd(),
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
}

async function capturePane(
  socketPath: string,
  sessionName: string
): Promise<string> {
  const result = await tmuxCommand(
    socketPath,
    ["capture-pane", "-p", "-t", sessionName, "-S", "-400"],
    30_000
  );
  return result.stdout;
}

async function waitForVisibleText({
  socketPath,
  sessionName,
  expectedText,
  timeoutMs,
  requireIdle = false,
}: {
  socketPath: string;
  sessionName: string;
  expectedText: string;
  timeoutMs: number;
  requireIdle?: boolean;
}): Promise<number> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const pane = await capturePane(socketPath, sessionName);
    const hasText = pane.includes(expectedText);
    const isIdle =
      !pane.includes("Working (") &&
      !pane.includes("esc to interrupt");
    if (hasText && (!requireIdle || isIdle)) {
      return performance.now() - startedAt;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    `Timed out waiting for "${expectedText}" in interactive pane ${sessionName}`
  );
}

async function startInteractiveSession({
  socketPath,
  sessionName,
  workspaceRoot,
  initialPrompt,
  timeoutMs,
}: {
  socketPath: string;
  sessionName: string;
  workspaceRoot: string;
  initialPrompt: string;
  timeoutMs: number;
}): Promise<void> {
  const trustConfig = `projects.${JSON.stringify(
    workspaceRoot
  )}.trust_level="trusted"`;
  const command = [
    "cd",
    shellQuote(workspaceRoot),
    "&&",
    "exec",
    "codex",
    "--no-alt-screen",
    "-c",
    shellQuote(trustConfig),
    "-C",
    shellQuote(workspaceRoot),
    "--sandbox",
    "read-only",
    "--dangerously-bypass-approvals-and-sandbox",
    shellQuote(initialPrompt),
  ].join(" ");

  await tmuxCommand(
    socketPath,
    ["new-session", "-d", "-s", sessionName, command],
    timeoutMs
  );
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  await tmuxCommand(socketPath, ["send-keys", "-t", sessionName, "C-m"], 10_000);
}

async function killTmuxServer(socketPath: string): Promise<void> {
  try {
    await tmuxCommand(socketPath, ["kill-server"], 10_000);
  } catch {
    // no-op
  }
}

async function measureInteractiveWarmTurn({
  workspaceRoot,
  warmupPrompt,
  warmupExpected,
  measuredPrompt,
  measuredExpected,
  timeoutMs,
}: {
  workspaceRoot: string;
  warmupPrompt: string;
  warmupExpected: string;
  measuredPrompt: string;
  measuredExpected: string;
  timeoutMs: number;
}): Promise<number> {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "rocky-interactive-kept-open-")
  );
  const socketPath = path.join(tempRoot, "tmux.sock");
  const sessionName = "probe";

  try {
    await startInteractiveSession({
      socketPath,
      sessionName,
      workspaceRoot,
      initialPrompt: warmupPrompt,
      timeoutMs,
    });

    await waitForVisibleText({
      socketPath,
      sessionName,
      expectedText: warmupExpected,
      timeoutMs,
      requireIdle: true,
    });

    const startedAt = performance.now();
    await tmuxCommand(
      socketPath,
      ["send-keys", "-t", sessionName, measuredPrompt],
      10_000
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    await tmuxCommand(socketPath, ["send-keys", "-t", sessionName, "Enter"], 10_000);

    const remainingTimeoutMs = Math.max(
      1_000,
      timeoutMs - Math.round(performance.now() - startedAt)
    );
    const visibleMs = await waitForVisibleText({
      socketPath,
      sessionName,
      expectedText: measuredExpected,
      timeoutMs: remainingTimeoutMs,
      requireIdle: true,
    });

    return visibleMs;
  } finally {
    await killTmuxServer(socketPath);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function runMeasuredServiceStreamCommand({
  args,
  env,
  cwd,
  timeoutMs,
  expectedSubstring,
}: {
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  timeoutMs: number;
  expectedSubstring: string;
}): Promise<{ visibleMs: number; durationMs: number; stdout: string }> {
  const child = spawn(process.execPath, [cliPath(), ...args], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const startedAt = performance.now();
  let stdout = "";
  let stderr = "";
  let visibleMs: number | null = null;
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, timeoutMs);

  child.stdout.on("data", (chunk: Buffer | string) => {
    const text = chunk.toString();
    stdout += text;
    if (visibleMs === null && stdout.includes(expectedSubstring)) {
      visibleMs = performance.now() - startedAt;
    }
  });

  child.stderr.on("data", (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });

  const completion = await new Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  });

  clearTimeout(timeout);

  if (timedOut) {
    throw new Error(
      `Timed out waiting for service stream command: ${args.join(" ")}\n${stderr}`
    );
  }

  assert.equal(
    completion.exitCode,
    0,
    `Service stream command failed with exit code ${completion.exitCode}\n${stderr}`
  );
  assert.notEqual(
    visibleMs,
    null,
    `Expected substring "${expectedSubstring}" was not visible in service stdout.\n${stdout}`
  );

  return {
    visibleMs: visibleMs as number,
    durationMs: performance.now() - startedAt,
    stdout,
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      iterations: { type: "string" },
      "timeout-ms": { type: "string" },
      output: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });

  if (values.help) {
    printUsage();
    return;
  }

  const iterations = values.iterations
    ? Number(values.iterations)
    : DEFAULT_ITERATIONS;
  if (!Number.isInteger(iterations) || iterations <= 0) {
    throw new Error("--iterations must be a positive integer");
  }

  const timeoutMs = values["timeout-ms"]
    ? Number(values["timeout-ms"])
    : DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive integer");
  }

  const outputPath = values.output ? path.resolve(values.output) : null;
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "rocky-kept-open-vs-service-")
  );
  const stateRoot = path.join(tempRoot, "state");
  const env = { ...process.env };
  const agentId = `rocky-keep-open-vs-service-${Date.now()}`;
  const interactiveSamples: VisibleSample[] = [];
  const serviceSamples: ServiceSample[] = [];

  const warmupSource = "rocky-keep-open-warmup";
  const measuredSource = "rocky-keep-open-measured";
  const warmupPrompt = `Return the base64 encoding of the ASCII string ${warmupSource} and nothing else.`;
  const measuredPrompt = `Return the base64 encoding of the ASCII string ${measuredSource} and nothing else.`;
  const warmupExpected = Buffer.from(warmupSource, "utf8").toString("base64");
  const measuredExpected = Buffer.from(measuredSource, "utf8").toString("base64");

  let runError: unknown = null;

  try {
    await ensureCodexAvailable(env, timeoutMs);

    logStep("Create benchmark agent");
    const createdAgent = await runCliJsonCommand(
      [
        "agent",
        "create",
        "--state-root",
        stateRoot,
        "--id",
        agentId,
        "--name",
        "Rocky kept-open benchmark agent",
        "--sandbox",
        "read-only",
      ],
      env,
      timeoutMs
    );
    assert.equal(createdAgent.id, agentId);
    const workspaceRoot = String(createdAgent.workspaceRoot);

    logStep("Measure kept-open interactive follow-up vs warmed service turn");
    for (let iteration = 1; iteration <= iterations; iteration += 1) {
      const interactiveVisibleMs = await measureInteractiveWarmTurn({
        workspaceRoot,
        warmupPrompt,
        warmupExpected,
        measuredPrompt,
        measuredExpected,
        timeoutMs,
      });
      interactiveSamples.push({
        iteration,
        visibleMs: interactiveVisibleMs,
      });

      const createdSession = await runCliJsonCommand(
        [
          "session",
          "create",
          agentId,
          "--state-root",
          stateRoot,
          "--title",
          `Rocky interactive-vs-service ${iteration}`,
        ],
        env,
        timeoutMs
      );
      const sessionId = String(createdSession.id);

      const warmupResult = await runCliJsonCommand(
        [
          "session",
          "send",
          sessionId,
          "--state-root",
          stateRoot,
          "--prompt",
          warmupPrompt,
        ],
        env,
        timeoutMs
      );
      assert.equal(
        warmupResult?.result?.status,
        "completed",
        `service warmup iteration ${iteration} should complete`
      );

      const serviceMeasured = await runMeasuredServiceStreamCommand({
        args: [
          "session",
          "send",
          sessionId,
          "--state-root",
          stateRoot,
          "--prompt",
          measuredPrompt,
          "--stream",
        ],
        env,
        cwd: process.cwd(),
        timeoutMs,
        expectedSubstring: measuredExpected,
      });
      parseNdjson(
        serviceMeasured.stdout,
        `service measured iteration ${iteration}`
      );
      serviceSamples.push({
        iteration,
        visibleMs: serviceMeasured.visibleMs,
        commandDurationMs: serviceMeasured.durationMs,
      });

      console.error(
        [
          `iteration ${iteration}/${iterations}`,
          `interactive-kept-open visible=${interactiveVisibleMs.toFixed(1)}ms`,
          `service-warm visible=${serviceMeasured.visibleMs.toFixed(1)}ms`,
          `service-warm total=${serviceMeasured.durationMs.toFixed(1)}ms`,
        ].join(" | ")
      );
    }

    const result = {
      generatedAt: new Date().toISOString(),
      config: {
        iterations,
        timeoutMs,
        stateRoot,
        benchmarkMode:
          "interactive kept-open follow-up turn vs current service warmed session turn",
        notes: [
          "Interactive path uses the same managed agent workspace as the service benchmark agent.",
          "Interactive path measures a follow-up prompt after a warm-up prompt has already completed in a kept-open codex session.",
          "Service path measures the second session turn after a warm-up session send has already established the runtime session.",
          "This benchmark uses the CLI service path and excludes browser/HTTP overhead.",
        ],
      },
      prompts: {
        warmupPrompt,
        measuredPrompt,
        warmupExpected,
        measuredExpected,
      },
      scenarios: {
        interactiveKeptOpen: {
          samples: interactiveSamples,
          visibleMs: summarize(interactiveSamples.map((sample) => sample.visibleMs)),
        },
        serviceWarmSession: {
          samples: serviceSamples,
          visibleMs: summarize(serviceSamples.map((sample) => sample.visibleMs)),
          commandDurationMs: summarize(
            serviceSamples.map((sample) => sample.commandDurationMs)
          ),
        },
      },
      deltas: {
        visibleAvgMs:
          summarize(serviceSamples.map((sample) => sample.visibleMs)).avgMs -
          summarize(interactiveSamples.map((sample) => sample.visibleMs)).avgMs,
      },
    };

    if (outputPath) {
      await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
      console.error(`Saved benchmark result to ${outputPath}`);
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    runError = error;
    throw error;
  } finally {
    if (runError !== null) {
      console.error(`Preserved benchmark temp root for debugging: ${tempRoot}`);
    } else {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
