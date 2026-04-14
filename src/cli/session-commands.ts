import type { CliContext } from "./cli-types.js";
import {
  unknownCommandError,
  usageError,
  writeJson,
  writeJsonLine,
} from "./cli-helpers.js";

export async function handleSessionCommand(
  command: string | undefined,
  targetId: string | undefined,
  context: CliContext
): Promise<number> {
  if (command === "list") {
    if (!targetId) {
      return usageError(context.stderr, "session list requires <agent-id>");
    }

    writeJson(context.stdout, await context.sessionService.listAgentSessions(targetId));
    return 0;
  }

  if (command === "create") {
    if (!targetId) {
      return usageError(context.stderr, "session create requires <agent-id>");
    }

    writeJson(
      context.stdout,
      await context.sessionService.createSession({
        agentId: targetId,
        title: context.values.title ?? null,
      })
    );
    return 0;
  }

  if (command === "get") {
    if (!targetId) {
      return usageError(context.stderr, "session get requires <session-id>");
    }

    writeJson(context.stdout, await context.sessionService.getSession(targetId));
    return 0;
  }

  if (command === "transcript") {
    if (!targetId) {
      return usageError(context.stderr, "session transcript requires <session-id>");
    }

    writeJson(context.stdout, await context.sessionService.getTranscript(targetId));
    return 0;
  }

  if (command === "send") {
    if (!targetId) {
      return usageError(context.stderr, "session send requires <session-id>");
    }

    if (!context.values.prompt) {
      return usageError(context.stderr, "session send requires --prompt <text>");
    }

    const run = await context.sessionService.sendTurn({
      sessionId: targetId,
      prompt: context.values.prompt,
    });

    if (context.values.stream) {
      for await (const event of context.sessionService.streamRunEvents(run.id)) {
        writeJsonLine(context.stdout, {
          type: "event",
          runId: run.id,
          event,
        });
      }

      writeJsonLine(context.stdout, {
        type: "result",
        run,
        result: await context.sessionService.getRunResult(run.id),
      });
      return 0;
    }

    writeJson(context.stdout, {
      run,
      result: await context.sessionService.getRunResult(run.id),
    });
    return 0;
  }

  return unknownCommandError(context.stderr, command);
}
