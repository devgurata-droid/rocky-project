#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_FIRST_PROMPT = "Reply with exactly OK and nothing else.";
const DEFAULT_SECOND_PROMPT = "Reply with exactly CONTINUE and nothing else.";
const DEFAULT_TIMEOUT_MS = 240_000;
const DEFAULT_ITERATIONS = 3;

interface MeasuredCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  firstStdoutByteMs: number | null;
  firstStdoutLineMs: number | null;
}

interface Sample {
  iteration: number;
  durationMs: number;
  firstStdoutByteMs: number | null;
  firstStdoutLineMs: number | null;
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
  npm run benchmark:latency -- [options]
  node dist/scripts/session-latency-benchmark.js [options]

Options:
  --iterations <number>     Number of repeated first/resume measurements per path. Defaults to 3.
  --state-root <path>       Reuse a specific service state root. Defaults to an auto-cleaned temp directory.
  --timeout-ms <number>     Timeout per command. Defaults to 240000.
  --first-prompt <text>     Prompt for the first turn.
  --second-prompt <text>    Prompt for the resumed turn.
  --output <path>           Write the benchmark JSON result to a file.
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

async function runMeasuredCommand({
  command,
  args,
  env,
  cwd,
  timeoutMs,
}: {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  timeoutMs: number;
}): Promise<MeasuredCommandResult> {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const startedAt = performance.now();
  let stdout = "";
  let stderr = "";
  let stdoutLineBuffer = "";
  let firstStdoutByteMs: number | null = null;
  let firstStdoutLineMs: number | null = null;
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, timeoutMs);

  child.stdout.on("data", (chunk: Buffer | string) => {
    const text = chunk.toString();
    if (text.length > 0 && firstStdoutByteMs === null) {
      firstStdoutByteMs = performance.now() - startedAt;
    }
    stdout += text;
    stdoutLineBuffer += text;

    if (firstStdoutLineMs !== null) {
      return;
    }

    const lineBreakIndex = stdoutLineBuffer.indexOf("\n");
    if (lineBreakIndex >= 0) {
      const firstLine = stdoutLineBuffer.slice(0, lineBreakIndex).trim();
      if (firstLine.length > 0) {
        firstStdoutLineMs = performance.now() - startedAt;
      }
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
    child.once("close", (exitCode, signal) => {
      resolve({ exitCode, signal });
    });
  });

  clearTimeout(timeout);

  if (firstStdoutLineMs === null && stdout.trim().length > 0) {
    firstStdoutLineMs = firstStdoutByteMs;
  }

  if (timedOut) {
    throw new Error(
      `Command timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}\n${stderr}`
    );
  }

  return {
    stdout,
    stderr,
    exitCode: completion.exitCode,
    signal: completion.signal,
    durationMs: performance.now() - startedAt,
    firstStdoutByteMs,
    firstStdoutLineMs,
  };
}

function assertSuccessfulCommand(
  result: MeasuredCommandResult,
  label: string
): void {
  assert.equal(
    result.exitCode,
    0,
    `${label} failed with exit code ${result.exitCode}\n${result.stderr}`
  );
}

function extractThreadId(events: any[], label: string): string {
  const threadId = events.find((event) => event?.type === "thread.started")
    ?.thread_id;
  assert.equal(
    typeof threadId,
    "string",
    `${label} should emit thread.started with thread_id`
  );
  return threadId as string;
}

function extractServiceResult(lines: any[], label: string): any {
  const finalLine = lines.at(-1);
  assert.equal(finalLine?.type, "result", `${label} should end with a result line`);
  assert.equal(
    finalLine?.result?.status,
    "completed",
    `${label} should complete successfully`
  );
  return finalLine.result;
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

function summarizeMetric(
  samples: Sample[],
  selector: (sample: Sample) => number | null
): SummaryStats | null {
  const values = samples
    .map(selector)
    .filter((value): value is number => value !== null);
  return values.length > 0 ? summarize(values) : null;
}

function formatMetric(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(1)}ms`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      iterations: { type: "string" },
      "state-root": { type: "string" },
      "timeout-ms": { type: "string" },
      "first-prompt": { type: "string" },
      "second-prompt": { type: "string" },
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

  const tempRoot =
    values["state-root"] === undefined
      ? await mkdtemp(path.join(os.tmpdir(), "agent-engine-latency-benchmark-"))
      : null;
  const stateRoot = path.resolve(
    values["state-root"] ?? path.join(tempRoot ?? process.cwd(), "state")
  );
  const firstPrompt = values["first-prompt"] ?? DEFAULT_FIRST_PROMPT;
  const secondPrompt = values["second-prompt"] ?? DEFAULT_SECOND_PROMPT;
  const outputPath = values.output ? path.resolve(values.output) : null;
  const env = { ...process.env };
  const agentId = `latency-benchmark-agent-${Date.now()}`;
  const directWorkspace = process.cwd();

  const directFirstSamples: Sample[] = [];
  const directResumeSamples: Sample[] = [];
  const serviceFirstSamples: Sample[] = [];
  const serviceResumeSamples: Sample[] = [];

  let runError: unknown = null;

  try {
    await ensureCodexAvailable(env, timeoutMs);

    logStep("Build benchmark state");
    console.error(
      `stateRoot: ${stateRoot}${tempRoot ? " (auto-cleanup on exit)" : " (preserved)"}`
    );

    const createdAgent = await runCliJsonCommand(
      [
        "agent",
        "create",
        "--state-root",
        stateRoot,
        "--id",
        agentId,
        "--name",
        "Latency Benchmark Agent",
        "--sandbox",
        "read-only",
      ],
      env,
      timeoutMs
    );
    assert.equal(createdAgent.id, agentId);

    logStep("Run repeated latency benchmark");
    for (let iteration = 1; iteration <= iterations; iteration += 1) {
      const createdSession = await runCliJsonCommand(
        [
          "session",
          "create",
          agentId,
          "--state-root",
          stateRoot,
          "--title",
          `Latency Benchmark ${iteration}`,
        ],
        env,
        timeoutMs
      );
      const sessionId = String(createdSession.id);

      const directFirst = await runMeasuredCommand({
        command: "codex",
        args: [
          "-C",
          directWorkspace,
          "--sandbox",
          "read-only",
          "--dangerously-bypass-approvals-and-sandbox",
          "exec",
          "--json",
          "--color",
          "never",
          "--skip-git-repo-check",
          firstPrompt,
        ],
        env,
        cwd: process.cwd(),
        timeoutMs,
      });
      assertSuccessfulCommand(directFirst, `direct first iteration ${iteration}`);
      const directFirstEvents = parseNdjson(
        directFirst.stdout,
        `direct first iteration ${iteration}`
      );
      const threadId = extractThreadId(
        directFirstEvents,
        `direct first iteration ${iteration}`
      );
      directFirstSamples.push({
        iteration,
        durationMs: directFirst.durationMs,
        firstStdoutByteMs: directFirst.firstStdoutByteMs,
        firstStdoutLineMs: directFirst.firstStdoutLineMs,
      });

      const directResume = await runMeasuredCommand({
        command: "codex",
        args: [
          "-C",
          directWorkspace,
          "--sandbox",
          "read-only",
          "--dangerously-bypass-approvals-and-sandbox",
          "exec",
          "resume",
          "--json",
          "--skip-git-repo-check",
          threadId,
          secondPrompt,
        ],
        env,
        cwd: process.cwd(),
        timeoutMs,
      });
      assertSuccessfulCommand(directResume, `direct resume iteration ${iteration}`);
      parseNdjson(directResume.stdout, `direct resume iteration ${iteration}`);
      directResumeSamples.push({
        iteration,
        durationMs: directResume.durationMs,
        firstStdoutByteMs: directResume.firstStdoutByteMs,
        firstStdoutLineMs: directResume.firstStdoutLineMs,
      });

      const serviceFirst = await runMeasuredCommand({
        command: process.execPath,
        args: [
          cliPath(),
          "session",
          "send",
          sessionId,
          "--state-root",
          stateRoot,
          "--prompt",
          firstPrompt,
          "--stream",
        ],
        env,
        cwd: process.cwd(),
        timeoutMs,
      });
      assertSuccessfulCommand(serviceFirst, `service first iteration ${iteration}`);
      const serviceFirstLines = parseNdjson(
        serviceFirst.stdout,
        `service first iteration ${iteration}`
      );
      const serviceFirstResult = extractServiceResult(
        serviceFirstLines,
        `service first iteration ${iteration}`
      );
      assert.equal(
        serviceFirstResult.status,
        "completed",
        `service first iteration ${iteration} should complete`
      );
      serviceFirstSamples.push({
        iteration,
        durationMs: serviceFirst.durationMs,
        firstStdoutByteMs: serviceFirst.firstStdoutByteMs,
        firstStdoutLineMs: serviceFirst.firstStdoutLineMs,
      });

      const serviceResume = await runMeasuredCommand({
        command: process.execPath,
        args: [
          cliPath(),
          "session",
          "send",
          sessionId,
          "--state-root",
          stateRoot,
          "--prompt",
          secondPrompt,
          "--stream",
        ],
        env,
        cwd: process.cwd(),
        timeoutMs,
      });
      assertSuccessfulCommand(serviceResume, `service resume iteration ${iteration}`);
      const serviceResumeLines = parseNdjson(
        serviceResume.stdout,
        `service resume iteration ${iteration}`
      );
      const serviceResumeResult = extractServiceResult(
        serviceResumeLines,
        `service resume iteration ${iteration}`
      );
      assert.equal(
        serviceResumeResult.status,
        "completed",
        `service resume iteration ${iteration} should complete`
      );
      serviceResumeSamples.push({
        iteration,
        durationMs: serviceResume.durationMs,
        firstStdoutByteMs: serviceResume.firstStdoutByteMs,
        firstStdoutLineMs: serviceResume.firstStdoutLineMs,
      });

      console.error(
        [
          `iteration ${iteration}/${iterations}`,
          `direct:first total=${formatMetric(directFirst.durationMs)} firstLine=${formatMetric(
            directFirst.firstStdoutLineMs
          )}`,
          `direct:resume total=${formatMetric(directResume.durationMs)} firstLine=${formatMetric(
            directResume.firstStdoutLineMs
          )}`,
          `service:first total=${formatMetric(serviceFirst.durationMs)} firstLine=${formatMetric(
            serviceFirst.firstStdoutLineMs
          )}`,
          `service:resume total=${formatMetric(
            serviceResume.durationMs
          )} firstLine=${formatMetric(serviceResume.firstStdoutLineMs)}`,
        ].join(" | ")
      );
    }

    const result = {
      generatedAt: new Date().toISOString(),
      config: {
        iterations,
        stateRoot,
        directWorkspace,
        firstPrompt,
        secondPrompt,
        timeoutMs,
      },
      scenarios: {
        directFirst: {
          samples: directFirstSamples,
          durationMs: summarizeMetric(directFirstSamples, (sample) => sample.durationMs),
          firstStdoutLineMs: summarizeMetric(
            directFirstSamples,
            (sample) => sample.firstStdoutLineMs
          ),
        },
        directResume: {
          samples: directResumeSamples,
          durationMs: summarizeMetric(directResumeSamples, (sample) => sample.durationMs),
          firstStdoutLineMs: summarizeMetric(
            directResumeSamples,
            (sample) => sample.firstStdoutLineMs
          ),
        },
        serviceFirst: {
          samples: serviceFirstSamples,
          durationMs: summarizeMetric(serviceFirstSamples, (sample) => sample.durationMs),
          firstStdoutLineMs: summarizeMetric(
            serviceFirstSamples,
            (sample) => sample.firstStdoutLineMs
          ),
        },
        serviceResume: {
          samples: serviceResumeSamples,
          durationMs: summarizeMetric(serviceResumeSamples, (sample) => sample.durationMs),
          firstStdoutLineMs: summarizeMetric(
            serviceResumeSamples,
            (sample) => sample.firstStdoutLineMs
          ),
        },
      },
      deltas: {
        firstTurnDurationAvgMs:
          summarizeMetric(serviceFirstSamples, (sample) => sample.durationMs)!.avgMs -
          summarizeMetric(directFirstSamples, (sample) => sample.durationMs)!.avgMs,
        resumedTurnDurationAvgMs:
          summarizeMetric(serviceResumeSamples, (sample) => sample.durationMs)!.avgMs -
          summarizeMetric(directResumeSamples, (sample) => sample.durationMs)!.avgMs,
        firstTurnFirstLineAvgMs:
          (summarizeMetric(serviceFirstSamples, (sample) => sample.firstStdoutLineMs)?.avgMs ??
            0) -
          (summarizeMetric(directFirstSamples, (sample) => sample.firstStdoutLineMs)?.avgMs ??
            0),
        resumedTurnFirstLineAvgMs:
          (summarizeMetric(serviceResumeSamples, (sample) => sample.firstStdoutLineMs)?.avgMs ??
            0) -
          (summarizeMetric(directResumeSamples, (sample) => sample.firstStdoutLineMs)?.avgMs ??
            0),
      },
    };

    if (outputPath) {
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
      console.error(`Saved benchmark result to ${outputPath}`);
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    runError = error;
    throw error;
  } finally {
    if (tempRoot && runError === null) {
      await rm(tempRoot, { recursive: true, force: true });
    } else if (tempRoot) {
      console.error(`Preserved benchmark temp root for debugging: ${tempRoot}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
