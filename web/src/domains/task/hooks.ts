import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentEngineClient } from "@/shared/lib/api-client";
import type { AgentTaskRecord, AgentTaskRunRecord } from "@/domains/task/types";

const RUNNING_TASK_REFRESH_INTERVAL_MS = 2000;

export const taskQueryKeys = {
  tasks: (agentId: string, includeArchived = false) =>
    ["agent-tasks", agentId, includeArchived ? "all" : "active"] as const,
  task: (taskId: string) => ["task", taskId] as const,
  taskRuns: (taskId: string) => ["task-runs", taskId] as const,
};

export function useAgentTasksQuery(
  agentId: string | undefined,
  options: {
    includeArchived?: boolean;
  } = {}
) {
  return useQuery({
    queryKey: taskQueryKeys.tasks(agentId ?? "unknown", options.includeArchived ?? false),
    queryFn: () =>
      agentEngineClient.listAgentTasks(agentId!, {
        includeArchived: options.includeArchived ?? false,
      }),
    enabled: Boolean(agentId),
    refetchInterval: (query) => {
      const tasks = query.state.data as AgentTaskRecord[] | undefined;
      return tasks?.some((task) => task.lastRunStatus === "running")
        ? RUNNING_TASK_REFRESH_INTERVAL_MS
        : false;
    },
    refetchIntervalInBackground: true,
  });
}

export function useTaskQuery(taskId: string | undefined) {
  return useQuery({
    queryKey: taskQueryKeys.task(taskId ?? "unknown"),
    queryFn: () => agentEngineClient.getTask(taskId!),
    enabled: Boolean(taskId),
    refetchInterval: (query) => {
      const task = query.state.data as AgentTaskRecord | undefined;
      return task?.lastRunStatus === "running"
        ? RUNNING_TASK_REFRESH_INTERVAL_MS
        : false;
    },
    refetchIntervalInBackground: true,
  });
}

export function useTaskRunsQuery(taskId: string | undefined) {
  return useQuery({
    queryKey: taskQueryKeys.taskRuns(taskId ?? "unknown"),
    queryFn: () => agentEngineClient.listTaskRuns(taskId!),
    enabled: Boolean(taskId),
    refetchInterval: (query) => {
      const runs = query.state.data as AgentTaskRunRecord[] | undefined;
      return runs?.some((run) => run.status === "running")
        ? RUNNING_TASK_REFRESH_INTERVAL_MS
        : false;
    },
    refetchIntervalInBackground: true,
  });
}

export function useCreateTaskMutation(agentId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: Parameters<typeof agentEngineClient.createTask>[1]) => {
      if (!agentId) {
        throw new Error("Agent id is required to create a task.");
      }

      return agentEngineClient.createTask(agentId, input);
    },
    onSuccess: async (task) => {
      queryClient.setQueryData(taskQueryKeys.task(task.id), task);
      if (!agentId) {
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: taskQueryKeys.tasks(agentId, false),
        }),
        queryClient.invalidateQueries({
          queryKey: taskQueryKeys.tasks(agentId, true),
        }),
      ]);
    },
  });
}

export function useUpdateTaskMutation(agentId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      taskId: string;
      changes: Parameters<typeof agentEngineClient.updateTask>[1];
    }) => agentEngineClient.updateTask(input.taskId, input.changes),
    onSuccess: async (task) => {
      queryClient.setQueryData(taskQueryKeys.task(task.id), task);
      if (!agentId) {
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: taskQueryKeys.tasks(agentId, false),
        }),
        queryClient.invalidateQueries({
          queryKey: taskQueryKeys.tasks(agentId, true),
        }),
      ]);
    },
  });
}

export function useDeleteTaskMutation(agentId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (taskId: string) => {
      await agentEngineClient.deleteTask(taskId);
      return taskId;
    },
    onSuccess: async (taskId) => {
      queryClient.removeQueries({
        queryKey: taskQueryKeys.task(taskId),
      });
      queryClient.removeQueries({
        queryKey: taskQueryKeys.taskRuns(taskId),
      });
      if (!agentId) {
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: taskQueryKeys.tasks(agentId, false),
        }),
        queryClient.invalidateQueries({
          queryKey: taskQueryKeys.tasks(agentId, true),
        }),
      ]);
    },
  });
}

export function useRunTaskMutation(agentId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (taskId: string) => agentEngineClient.runTask(taskId),
    onSuccess: async (taskRun) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: taskQueryKeys.task(taskRun.taskId),
        }),
        queryClient.invalidateQueries({
          queryKey: taskQueryKeys.taskRuns(taskRun.taskId),
        }),
      ]);
      if (!agentId) {
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: taskQueryKeys.tasks(agentId, false),
        }),
        queryClient.invalidateQueries({
          queryKey: taskQueryKeys.tasks(agentId, true),
        }),
      ]);
    },
  });
}
