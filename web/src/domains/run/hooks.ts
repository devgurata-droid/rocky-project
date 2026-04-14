import { useQuery, useMutation } from "@tanstack/react-query";

import { agentEngineClient } from "@/shared/lib/api-client";

export const runQueryKeys = {
  run: (runId: string) => ["run", runId] as const,
  runResult: (runId: string) => ["run-result", runId] as const,
  runEvents: (runId: string) => ["run-events", runId] as const,
  runArtifacts: (runId: string) => ["run-artifacts", runId] as const,
};

/** @deprecated Use domain-specific query keys instead. */
export const agentEngineQueryKeys = runQueryKeys;

export function useRunQuery(runId: string | undefined) {
  return useQuery({
    queryKey: runQueryKeys.run(runId ?? "unknown"),
    queryFn: () => agentEngineClient.getRun(runId!),
    enabled: Boolean(runId),
  });
}

export function useRunResultQuery(runId: string | undefined) {
  return useQuery({
    queryKey: runQueryKeys.runResult(runId ?? "unknown"),
    queryFn: () => agentEngineClient.getRunResult(runId!),
    enabled: Boolean(runId),
  });
}

export function useRunEventsQuery(runId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: runQueryKeys.runEvents(runId ?? "unknown"),
    queryFn: () => agentEngineClient.getRunEvents(runId!),
    enabled: Boolean(runId) && enabled,
  });
}

export function useRunArtifactsQuery(runId: string | undefined) {
  return useQuery({
    queryKey: runQueryKeys.runArtifacts(runId ?? "unknown"),
    queryFn: () => agentEngineClient.listRunArtifacts(runId!),
    enabled: Boolean(runId),
  });
}

export function useCancelRunMutation() {
  return useMutation({
    mutationFn: async (runId: string) => agentEngineClient.cancelRun(runId),
  });
}
