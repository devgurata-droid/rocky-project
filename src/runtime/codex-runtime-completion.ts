import { buildRunResult, statusFromExit } from "./codex-run-result.js";

import type {
  RuntimeEvent,
  RuntimeRequest,
  RuntimeRunResult,
  RuntimeSession,
} from "./runtime-types.js";
import type { LiveRuntimeRunState } from "./codex-runtime-helpers.js";

export function createCodexRunCompletion({
  child,
  runId,
  session,
  run,
  command,
  args,
  request,
  eventQueue,
  now,
}: {
  child: RuntimeSession["runtimeKind"] extends string ? {
    once(event: "error", listener: (error: Error) => void): unknown;
    once(
      event: "close",
      listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void
    ): unknown;
  } : never;
  runId: string;
  session: RuntimeSession;
  run: LiveRuntimeRunState;
  command: string;
  args: string[];
  request: RuntimeRequest;
  eventQueue: {
    push(value: RuntimeEvent): void;
    close(): void;
  };
  now: () => string;
}): Promise<RuntimeRunResult> {
  return new Promise<RuntimeRunResult>((resolve) => {
    child.once("error", async (error: Error) => {
      run.endedAt = now();
      run.status = "failed";
      run.exitCode = null;
      run.signal = null;
      run.errors.push(error.message);
      run.result = await buildRunResult({
        runId,
        session,
        run,
        command,
        args,
        request,
      });
      eventQueue.push({
        source: "codex-cli",
        type: "run.error",
        runId,
        sessionId: session.id,
        runtimeSessionId: session.runtimeSessionId,
        rawType: "process.error",
        occurredAt: now(),
        data: { message: error.message, retriable: false },
        raw: { name: error.name, message: error.message },
      });
      eventQueue.close();
      resolve(run.result);
    });

    child.once("close", async (exitCode, signal) => {
      run.endedAt = now();
      run.status = statusFromExit({
        exitCode,
        signal,
        cancelled: run.cancelled,
      });
      run.exitCode = exitCode;
      run.signal = signal;
      run.result = await buildRunResult({
        runId,
        session,
        run,
        command,
        args,
        request,
      });
      eventQueue.push({
        source: "codex-cli",
        type: "run.completed",
        runId,
        sessionId: session.id,
        runtimeSessionId: session.runtimeSessionId,
        rawType: "process.close",
        occurredAt: now(),
        data: {
          status: run.status,
          exitCode,
          signal,
        },
        raw: {
          exitCode,
          signal,
        },
      });
      eventQueue.close();
      resolve(run.result);
    });
  });
}
