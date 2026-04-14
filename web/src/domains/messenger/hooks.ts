import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { agentEngineClient } from "@/shared/lib/api-client";
import type { TelegramMessengerConnectionInput } from "@/shared/lib/agent-engine-client";

export const messengerQueryKeys = {
  agentSlots: (agentId: string) => ["agent-messenger-slots", agentId] as const,
};

export function useAgentMessengerSlotsQuery(agentId: string | undefined) {
  return useQuery({
    queryKey: messengerQueryKeys.agentSlots(agentId ?? "unknown"),
    queryFn: () => agentEngineClient.listAgentMessengerConnections(agentId!),
    enabled: Boolean(agentId),
  });
}

export function useUpdateTelegramMessengerConnectionMutation(agentId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: TelegramMessengerConnectionInput) => {
      if (!agentId) {
        throw new Error("Agent id is required to update Telegram integration.");
      }

      return agentEngineClient.updateTelegramMessengerConnection(agentId, input);
    },
    onSuccess: async () => {
      if (!agentId) {
        return;
      }

      await queryClient.invalidateQueries({
        queryKey: messengerQueryKeys.agentSlots(agentId),
      });
    },
  });
}

export function useDeleteMessengerConnectionMutation(agentId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (provider: "kakao" | "telegram" | "slack" | "discord") => {
      if (!agentId) {
        throw new Error("Agent id is required to delete a messenger integration.");
      }

      await agentEngineClient.deleteAgentMessengerConnection(agentId, provider);
      return provider;
    },
    onSuccess: async () => {
      if (!agentId) {
        return;
      }

      await queryClient.invalidateQueries({
        queryKey: messengerQueryKeys.agentSlots(agentId),
      });
    },
  });
}
