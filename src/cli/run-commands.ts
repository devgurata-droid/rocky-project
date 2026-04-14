import type { CliContext } from "./cli-types.js";
import {
  unknownCommandError,
  usageError,
  writeJson,
  writeJsonLine,
} from "./cli-helpers.js";

export async function handleRunCommand(
  command: string | undefined,
  targetId: string | undefined,
  context: CliContext
): Promise<number> {
  if (command === "get") {
    if (!targetId) {
      return usageError(context.stderr, "run get requires <run-id>");
    }

    writeJson(context.stdout, await context.sessionService.getRun(targetId));
    return 0;
  }

  if (command === "events") {
    if (!targetId) {
      return usageError(context.stderr, "run events requires <run-id>");
    }

    for await (const event of context.sessionService.streamRunEvents(targetId)) {
      writeJsonLine(context.stdout, event);
    }
    return 0;
  }

  if (command === "cancel") {
    if (!targetId) {
      return usageError(context.stderr, "run cancel requires <run-id>");
    }

    await context.sessionService.cancelRun(targetId);
    writeJson(context.stdout, await context.sessionService.getRunResult(targetId));
    return 0;
  }

  return unknownCommandError(context.stderr, command);
}
