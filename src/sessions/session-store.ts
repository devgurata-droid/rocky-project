import path from "node:path";
import { access, appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

import { resolveAgentPaths } from "../agents/agent-manager.js";

import type {
  AgentRunPaths,
  AgentSessionPaths,
} from "./session-types.js";

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function serializeJsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export async function readJsonFile<T>(targetPath: string): Promise<T> {
  return JSON.parse(await readFile(targetPath, "utf8")) as T;
}

export async function appendJsonLine(
  targetPath: string,
  value: unknown
): Promise<void> {
  await appendFile(targetPath, serializeJsonLine(value), "utf8");
}

export async function readJsonLines<T>(targetPath: string): Promise<T[]> {
  if (!(await pathExists(targetPath))) {
    return [];
  }

  const content = await readFile(targetPath, "utf8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export async function writeJsonLines(
  targetPath: string,
  values: unknown[]
): Promise<void> {
  const body = values.map((value) => serializeJsonLine(value)).join("");
  await writeFile(targetPath, body, "utf8");
}

export function resolveAgentSessionPaths({
  stateRoot,
  agentId,
  sessionId,
}: {
  stateRoot?: string;
  agentId: string;
  sessionId: string;
}): AgentSessionPaths {
  const { agentRoot } = resolveAgentPaths({ stateRoot, agentId });
  const sessionRoot = path.join(agentRoot, "sessions", sessionId);

  return {
    sessionRoot,
    metadataPath: path.join(sessionRoot, "session.json"),
    transcriptPath: path.join(sessionRoot, "transcript.jsonl"),
  };
}

export function resolveAgentRunPaths({
  stateRoot,
  agentId,
  runId,
}: {
  stateRoot?: string;
  agentId: string;
  runId: string;
}): AgentRunPaths {
  const { agentRoot } = resolveAgentPaths({ stateRoot, agentId });
  const runRoot = path.join(agentRoot, "runs", runId);
  const artifactsDir = path.join(runRoot, "artifacts");

  return {
    runRoot,
    metadataPath: path.join(runRoot, "run.json"),
    resultPath: path.join(runRoot, "result.json"),
    eventsPath: path.join(runRoot, "events.jsonl"),
    artifactsDir,
    outputLastMessagePath: path.join(artifactsDir, "last-message.txt"),
  };
}

export async function ensureSessionPaths(
  paths: AgentSessionPaths
): Promise<void> {
  await mkdir(paths.sessionRoot, { recursive: true });

  if (!(await pathExists(paths.transcriptPath))) {
    await writeFile(paths.transcriptPath, "", "utf8");
  }
}

export async function ensureRunPaths(paths: AgentRunPaths): Promise<void> {
  await mkdir(paths.runRoot, { recursive: true });
  await mkdir(paths.artifactsDir, { recursive: true });

  if (!(await pathExists(paths.eventsPath))) {
    await writeFile(paths.eventsPath, "", "utf8");
  }
}

export async function findSessionLocation(
  stateRoot: string,
  sessionId: string
): Promise<{ agentId: string; paths: AgentSessionPaths } | null> {
  const agentsRoot = path.join(stateRoot, "agents");
  if (!(await pathExists(agentsRoot))) {
    return null;
  }

  const entries = await readdir(agentsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const paths = resolveAgentSessionPaths({
      stateRoot,
      agentId: entry.name,
      sessionId,
    });
    if (await pathExists(paths.metadataPath)) {
      return {
        agentId: entry.name,
        paths,
      };
    }
  }

  return null;
}

export async function findRunLocation(
  stateRoot: string,
  runId: string
): Promise<{ agentId: string; paths: AgentRunPaths } | null> {
  const agentsRoot = path.join(stateRoot, "agents");
  if (!(await pathExists(agentsRoot))) {
    return null;
  }

  const entries = await readdir(agentsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const paths = resolveAgentRunPaths({
      stateRoot,
      agentId: entry.name,
      runId,
    });
    if (await pathExists(paths.metadataPath)) {
      return {
        agentId: entry.name,
        paths,
      };
    }
  }

  return null;
}

export async function listAgentSessionPaths(
  stateRoot: string,
  agentId: string
): Promise<AgentSessionPaths[]> {
  const { agentRoot } = resolveAgentPaths({ stateRoot, agentId });
  const sessionsRoot = path.join(agentRoot, "sessions");

  if (!(await pathExists(sessionsRoot))) {
    return [];
  }

  const entries = await readdir(sessionsRoot, { withFileTypes: true });
  const paths = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      resolveAgentSessionPaths({
        stateRoot,
        agentId,
        sessionId: entry.name,
      })
    );

  const existingPaths = await Promise.all(
    paths.map(async (candidate) =>
      (await pathExists(candidate.metadataPath)) ? candidate : null
    )
  );

  return existingPaths.filter((candidate): candidate is AgentSessionPaths => candidate !== null);
}

export async function listAgentRunPaths(
  stateRoot: string,
  agentId: string
): Promise<AgentRunPaths[]> {
  const { agentRoot } = resolveAgentPaths({ stateRoot, agentId });
  const runsRoot = path.join(agentRoot, "runs");

  if (!(await pathExists(runsRoot))) {
    return [];
  }

  const entries = await readdir(runsRoot, { withFileTypes: true });
  const paths = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      resolveAgentRunPaths({
        stateRoot,
        agentId,
        runId: entry.name,
      })
    );

  const existingPaths = await Promise.all(
    paths.map(async (candidate) =>
      (await pathExists(candidate.metadataPath)) ? candidate : null
    )
  );

  return existingPaths.filter((candidate): candidate is AgentRunPaths => candidate !== null);
}
