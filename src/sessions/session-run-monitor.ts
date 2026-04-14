import { stat, writeFile } from "node:fs/promises";

import { AsyncEventQueue } from "../runtime/async-event-queue.js";
import {
  appendJsonLine,
  readJsonLines,
  serializeJson,
  writeJsonLines,
} from "./session-store.js";

import type {
  RuntimeEvent,
  RuntimeMessage,
  RuntimeRunResult,
} from "../runtime/runtime-types.js";
import type {
  AgentRunPaths,
  AgentRunRecord,
  AgentSessionMessage,
  AgentSessionPaths,
  AgentSessionRecord,
  SessionServiceOptions,
} from "./session-types.js";
import {
  buildMessageRecord,
  buildArtifactManifestEntry,
  buildMessageBlocks,
  sessionStatusFromRunStatus,
  truncateSummary,
} from "./session-service-helpers.js";

async function writeSessionRecord(
  sessionPaths: AgentSessionPaths,
  session: AgentSessionRecord
): Promise<void> {
  await writeFile(sessionPaths.metadataPath, serializeJson(session), "utf8");
}

async function writeRunRecord(
  runPaths: AgentRunPaths,
  run: AgentRunRecord
): Promise<void> {
  await writeFile(runPaths.metadataPath, serializeJson(run), "utf8");
}

async function persistMissingMessages({
  runId,
  sessionId,
  transcriptPath,
  messages,
  seenTexts,
}: {
  runId: string;
  sessionId: string;
  transcriptPath: string;
  messages: RuntimeMessage[];
  seenTexts: Set<string>;
}): Promise<void> {
  let offset = 0;
  for (const message of messages) {
    if (seenTexts.has(message.text)) {
      continue;
    }

    offset += 1;
    await appendJsonLine(
      transcriptPath,
      buildMessageRecord({
        id: `${runId}:assistant:fallback:${offset}`,
        sessionId,
        runId,
        role: "assistant",
        content: message.text,
        source: message.source,
        createdAt: message.occurredAt,
      })
    );
  }
}

async function enrichTranscriptArtifacts({
  run,
  transcriptPath,
  result,
}: {
  run: AgentRunRecord;
  transcriptPath: string;
  result: RuntimeRunResult;
}): Promise<void> {
  if (result.artifactRefs.length === 0) {
    return;
  }

  const transcript = await readJsonLines<AgentSessionMessage>(transcriptPath);
  const targetIndex = [...transcript]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find(
      ({ message }) =>
        message.runId === run.id && message.role === "assistant"
    )?.index;

  if (targetIndex === undefined) {
    return;
  }

  const artifacts = await Promise.all(
    result.artifactRefs.map(async (artifactRef) => {
      try {
        return buildArtifactManifestEntry(
          run.id,
          artifactRef,
          (await stat(artifactRef.path)).size
        );
      } catch {
        return buildArtifactManifestEntry(run.id, artifactRef, null);
      }
    })
  );

  transcript[targetIndex] = {
    ...transcript[targetIndex],
    artifacts,
    blocks: buildMessageBlocks(transcript[targetIndex].content, artifacts),
  };

  await writeJsonLines(transcriptPath, transcript);
}

export function monitorSessionRun({
  runtime,
  session,
  sessionPaths,
  run,
  runPaths,
  queue,
  onSettled,
}: {
  runtime: SessionServiceOptions["runtime"];
  session: AgentSessionRecord;
  sessionPaths: AgentSessionPaths;
  run: AgentRunRecord;
  runPaths: AgentRunPaths;
  queue: AsyncEventQueue<RuntimeEvent>;
  onSettled: () => void;
}): Promise<RuntimeRunResult> {
  const streamedAssistantTexts = new Set<string>();

  const eventPump = (async () => {
    for await (const event of runtime.streamEvents(run.id)) {
      await appendJsonLine(runPaths.eventsPath, event);

      if (
        event.type === "session.bound" &&
        typeof event.data.runtimeSessionId === "string"
      ) {
        session.runtimeSessionId = event.data.runtimeSessionId;
      }

      if (event.type === "assistant.message.completed") {
        const content = String(event.data.text ?? "");
        streamedAssistantTexts.add(content);
        await appendJsonLine(
          sessionPaths.transcriptPath,
          buildMessageRecord({
            id: `${run.id}:assistant:${streamedAssistantTexts.size}`,
            sessionId: session.id,
            runId: run.id,
            role: "assistant",
            content,
            source: String(event.rawType ?? event.type),
            createdAt: event.occurredAt,
          })
        );
      }

      queue.push(event);
    }
  })();

  return (async () => {
    try {
      const result = await runtime.getRunResult(run.id);
      await eventPump;
      await persistMissingMessages({
        runId: run.id,
        sessionId: session.id,
        transcriptPath: sessionPaths.transcriptPath,
        messages: result.messages,
        seenTexts: streamedAssistantTexts,
      });
      await enrichTranscriptArtifacts({
        run,
        transcriptPath: sessionPaths.transcriptPath,
        result,
      });

      run.status = result.status as AgentRunRecord["status"];
      run.endedAt = result.endedAt;
      run.summary = truncateSummary(result.lastMessage ?? result.messages.at(-1)?.text ?? null);
      run.runtimeSessionId = result.runtimeSessionId;
      run.outputLastMessagePath = result.outputLastMessagePath;

      session.runtimeSessionId = result.runtimeSessionId;
      session.status = sessionStatusFromRunStatus(result.status);
      session.lastActivityAt = result.endedAt ?? run.startedAt;

      await writeSessionRecord(sessionPaths, session);
      await writeRunRecord(runPaths, run);
      await writeFile(runPaths.resultPath, serializeJson(result), "utf8");

      return result;
    } finally {
      onSettled();
      queue.close();
    }
  })();
}
