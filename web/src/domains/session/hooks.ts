import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentEngineClient } from "@/shared/lib/api-client";
import { summarizeTaskRequestPrompt } from "@/domains/session/lib/request-status";
import { writeSessionRuntimeSelection } from "@/domains/session/lib/session-runtime-selection";
import type {
  AgentSessionRecord,
  AgentSessionCreateInput,
  AgentSessionUpdateInput,
} from "@/domains/session/types";
import type { AgentWorkspaceFilePreviewRecord } from "@/shared/lib/agent-engine-client";
import type {
  RuntimeKind,
  RuntimeOllamaLaunchTarget,
} from "@/shared/lib/agent-engine-client";

const RUNNING_TASK_REFRESH_INTERVAL_MS = 3000;

function buildTaskRequestPrompt(
  prompt: string,
  uploads: AgentWorkspaceFilePreviewRecord[]
): string {
  if (uploads.length === 0) {
    return prompt;
  }

  const uploadLines = uploads.map(
    (upload) =>
      `- ${upload.name} (${upload.contentType}, ${upload.path})`
  );

  return `${prompt}\n\n[업로드된 참고 파일]\n${uploadLines.join("\n")}\n\n위 파일들을 필요할 때 워크스페이스 경로에서 직접 열어 확인한 뒤 작업을 진행해줘.`;
}

function collectImageAttachmentPaths(
  uploads: AgentWorkspaceFilePreviewRecord[]
): string[] {
  return uploads
    .filter((upload) => upload.contentType.startsWith("image/"))
    .map((upload) => upload.path);
}

export const sessionQueryKeys = {
  sessions: (agentId: string, includeArchived = false) =>
    ["agent-sessions", agentId, includeArchived ? "all" : "active"] as const,
  session: (sessionId: string) => ["session", sessionId] as const,
  transcript: (sessionId: string) => ["transcript", sessionId] as const,
};

export function useAgentSessionsQuery(
  agentId: string | undefined,
  options: {
    includeArchived?: boolean;
  } = {}
) {
  return useQuery({
    queryKey: sessionQueryKeys.sessions(
      agentId ?? "unknown",
      options.includeArchived ?? false
    ),
    queryFn: () =>
      agentEngineClient.listAgentSessions(agentId!, {
        includeArchived: options.includeArchived ?? false,
        kinds: ["task-request"],
      }),
    enabled: Boolean(agentId),
    refetchInterval: (query) => {
      const sessions = query.state.data as AgentSessionRecord[] | undefined;
      return sessions?.some((session) => session.status === "running")
        ? RUNNING_TASK_REFRESH_INTERVAL_MS
        : false;
    },
  });
}

export function useSessionQuery(sessionId: string | undefined) {
  return useQuery({
    queryKey: sessionQueryKeys.session(sessionId ?? "unknown"),
    queryFn: () => agentEngineClient.getSession(sessionId!),
    enabled: Boolean(sessionId),
  });
}

export function useCreateSessionMutation(agentId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input?: AgentSessionCreateInput | null) => {
      if (!agentId) {
        throw new Error("Agent id is required to create a session.");
      }

      return agentEngineClient.createSession(agentId, input ?? {});
    },
    onSuccess: async () => {
      if (!agentId) {
        return;
      }

      await queryClient.invalidateQueries({
        queryKey: sessionQueryKeys.sessions(agentId),
      });
    },
  });
}

export function useCreateTaskRequestMutation(agentId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      prompt: string;
      runtimeKind?: RuntimeKind;
      ollamaLaunchTarget?: RuntimeOllamaLaunchTarget | null;
      model?: string | null;
      reasoningEffort?: string | null;
      serviceTier?: string | null;
      files?: File[];
    }) => {
      if (!agentId) {
        throw new Error("Agent id is required to create a task request.");
      }

      const normalizedPrompt = input.prompt.trim();
      if (!normalizedPrompt) {
        throw new Error("Task request prompt is required.");
      }

      let title = "";
      try {
        title = (
          await agentEngineClient.summarizeTaskRequestTitle(normalizedPrompt)
        ).title.trim();
      } catch {
        title = summarizeTaskRequestPrompt(normalizedPrompt);
      }

      const uploads = await Promise.all(
        (input.files ?? []).map((file) =>
          agentEngineClient.uploadAgentWorkspaceFile(agentId, file)
        )
      );

      const session = await agentEngineClient.createSession(agentId, {
        title,
        runtimeKind: input.runtimeKind,
        ollamaLaunchTarget: input.ollamaLaunchTarget ?? null,
        model: input.model ?? null,
        reasoningEffort: input.reasoningEffort ?? null,
        serviceTier: input.serviceTier ?? null,
      });
      writeSessionRuntimeSelection(session.id, {
        runtimeKind: session.runtimeKind,
        ollamaLaunchTarget: session.runtimeConfig.ollamaLaunchTarget ?? null,
        model: session.runtimeConfig.model ?? null,
        reasoningEffort: session.runtimeConfig.reasoningEffort ?? null,
        serviceTier: session.runtimeConfig.serviceTier ?? null,
      });
      const run = await agentEngineClient.sendMessage(
        session.id,
        buildTaskRequestPrompt(normalizedPrompt, uploads),
        {
          images: collectImageAttachmentPaths(uploads),
          runtimeKind: session.runtimeKind,
          ollamaLaunchTarget: session.runtimeConfig.ollamaLaunchTarget ?? undefined,
          model: session.runtimeConfig.model ?? null,
          reasoningEffort: session.runtimeConfig.reasoningEffort ?? null,
          serviceTier: session.runtimeConfig.serviceTier ?? null,
        }
      );

      return {
        session,
        run,
      };
    },
    onSuccess: async ({ session }) => {
      if (!agentId) {
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: sessionQueryKeys.sessions(agentId, false),
        }),
        queryClient.invalidateQueries({
          queryKey: sessionQueryKeys.sessions(agentId, true),
        }),
        queryClient.invalidateQueries({
          queryKey: sessionQueryKeys.session(session.id),
        }),
        queryClient.invalidateQueries({
          queryKey: sessionQueryKeys.transcript(session.id),
        }),
      ]);
    },
  });
}

export function useUpdateSessionMutation(agentId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      sessionId: string;
      changes: AgentSessionUpdateInput;
    }) => {
      return agentEngineClient.updateSession(input.sessionId, input.changes);
    },
    onSuccess: async (updated) => {
      queryClient.setQueryData(sessionQueryKeys.session(updated.id), updated);

      if (agentId) {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: sessionQueryKeys.sessions(agentId, false),
          }),
          queryClient.invalidateQueries({
            queryKey: sessionQueryKeys.sessions(agentId, true),
          }),
        ]);
      }
    },
  });
}

export function useDeleteSessionMutation(agentId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      sessionId: string;
      stopRunningRuns?: boolean;
    }) => {
      await agentEngineClient.deleteSession(input.sessionId, {
        stopRunningRuns: input.stopRunningRuns,
      });
      return input.sessionId;
    },
    onSuccess: async (sessionId) => {
      queryClient.removeQueries({
        queryKey: sessionQueryKeys.session(sessionId),
      });
      queryClient.removeQueries({
        queryKey: sessionQueryKeys.transcript(sessionId),
      });

      if (agentId) {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: sessionQueryKeys.sessions(agentId, false),
          }),
          queryClient.invalidateQueries({
            queryKey: sessionQueryKeys.sessions(agentId, true),
          }),
        ]);
      }
    },
  });
}

export function useTranscriptQuery(
  sessionId: string | undefined,
  options: {
    live?: boolean;
  } = {}
) {
  return useQuery({
    queryKey: sessionQueryKeys.transcript(sessionId ?? "unknown"),
    queryFn: () => agentEngineClient.getTranscript(sessionId!),
    enabled: Boolean(sessionId),
    refetchInterval: options.live ? RUNNING_TASK_REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: options.live === true,
  });
}

export function useSendMessageMutation(sessionId: string | undefined) {
  return useMutation({
    mutationFn: async (input: {
      agentId: string;
      prompt: string;
      files?: File[];
      runtimeKind?: RuntimeKind;
      ollamaLaunchTarget?: RuntimeOllamaLaunchTarget | null;
      model?: string | null;
      reasoningEffort?: string | null;
      serviceTier?: string | null;
      reuseMessageId?: string;
    }) => {
      if (!sessionId) {
        throw new Error("Session id is required to send a prompt.");
      }

      const normalizedPrompt = input.prompt.trim();
      if (!normalizedPrompt) {
        throw new Error("Prompt is required.");
      }

      const uploads = await Promise.all(
        (input.files ?? []).map((file) =>
          agentEngineClient.uploadAgentWorkspaceFile(input.agentId, file)
        )
      );

      return agentEngineClient.sendMessage(
        sessionId,
        buildTaskRequestPrompt(normalizedPrompt, uploads),
        {
          images: collectImageAttachmentPaths(uploads),
          runtimeKind: input.runtimeKind,
          ollamaLaunchTarget: input.ollamaLaunchTarget ?? undefined,
          model: input.model,
          reasoningEffort: input.reasoningEffort,
          serviceTier: input.serviceTier,
          reuseMessageId: input.reuseMessageId,
        }
      );
    },
  });
}
