import path from "node:path";
import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

import { resolveAgentPaths } from "../agents/agent-manager.js";
import { readJsonFile, serializeJson } from "../sessions/session-store.js";

import type {
  AgentTaskRecord,
  AgentTaskRunRecord,
} from "./task-types.js";

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export interface AgentTaskPaths {
  tasksRoot: string;
  taskPath: string;
}

export interface AgentTaskRunPaths {
  taskRunsRoot: string;
  taskRunPath: string;
}

export function resolveAgentTaskPaths({
  stateRoot,
  agentId,
  taskId,
}: {
  stateRoot?: string;
  agentId: string;
  taskId: string;
}): AgentTaskPaths {
  const { agentRoot } = resolveAgentPaths({
    stateRoot,
    agentId,
  });
  const tasksRoot = path.join(agentRoot, "tasks");

  return {
    tasksRoot,
    taskPath: path.join(tasksRoot, `${taskId}.json`),
  };
}

export function resolveAgentTaskRunPaths({
  stateRoot,
  agentId,
  taskRunId,
}: {
  stateRoot?: string;
  agentId: string;
  taskRunId: string;
}): AgentTaskRunPaths {
  const { agentRoot } = resolveAgentPaths({
    stateRoot,
    agentId,
  });
  const taskRunsRoot = path.join(agentRoot, "task-runs");

  return {
    taskRunsRoot,
    taskRunPath: path.join(taskRunsRoot, `${taskRunId}.json`),
  };
}

export async function ensureTaskPaths(paths: AgentTaskPaths): Promise<void> {
  await mkdir(paths.tasksRoot, { recursive: true });
}

export async function ensureTaskRunPaths(paths: AgentTaskRunPaths): Promise<void> {
  await mkdir(paths.taskRunsRoot, { recursive: true });
}

export async function writeTaskRecord(
  paths: AgentTaskPaths,
  task: AgentTaskRecord
): Promise<void> {
  await ensureTaskPaths(paths);
  await writeFile(paths.taskPath, serializeJson(task), "utf8");
}

export async function writeTaskRunRecord(
  paths: AgentTaskRunPaths,
  taskRun: AgentTaskRunRecord
): Promise<void> {
  await ensureTaskRunPaths(paths);
  await writeFile(paths.taskRunPath, serializeJson(taskRun), "utf8");
}

export async function listAgentTaskPaths(
  stateRoot: string,
  agentId: string
): Promise<AgentTaskPaths[]> {
  const { tasksRoot } = resolveAgentTaskPaths({
    stateRoot,
    agentId,
    taskId: "__placeholder__",
  });

  if (!(await pathExists(tasksRoot))) {
    return [];
  }

  const entries = await readdir(tasksRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => resolveAgentTaskPaths({
      stateRoot,
      agentId,
      taskId: entry.name.replace(/\.json$/u, ""),
    }));
}

export async function listAgentTaskRunPaths(
  stateRoot: string,
  agentId: string
): Promise<AgentTaskRunPaths[]> {
  const { taskRunsRoot } = resolveAgentTaskRunPaths({
    stateRoot,
    agentId,
    taskRunId: "__placeholder__",
  });

  if (!(await pathExists(taskRunsRoot))) {
    return [];
  }

  const entries = await readdir(taskRunsRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => resolveAgentTaskRunPaths({
      stateRoot,
      agentId,
      taskRunId: entry.name.replace(/\.json$/u, ""),
    }));
}

export async function findTaskLocation(
  stateRoot: string,
  taskId: string
): Promise<{ agentId: string; paths: AgentTaskPaths } | null> {
  const agentsRoot = path.join(stateRoot, "agents");
  if (!(await pathExists(agentsRoot))) {
    return null;
  }

  const entries = await readdir(agentsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const paths = resolveAgentTaskPaths({
      stateRoot,
      agentId: entry.name,
      taskId,
    });
    if (await pathExists(paths.taskPath)) {
      return {
        agentId: entry.name,
        paths,
      };
    }
  }

  return null;
}

export async function readTaskRecord(taskPath: string): Promise<AgentTaskRecord> {
  return readJsonFile<AgentTaskRecord>(taskPath);
}

export async function readTaskRunRecord(taskRunPath: string): Promise<AgentTaskRunRecord> {
  return readJsonFile<AgentTaskRunRecord>(taskRunPath);
}
