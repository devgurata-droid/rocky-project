import type { FastifyPluginAsync, FastifyPluginOptions } from "fastify";

import { sendJson } from "../http/reply.js";

import type { AgentMessengerServiceLike } from "../../messenger/messenger-types.js";

interface MessengerRoutesOptions extends FastifyPluginOptions {
  agentMessengerService: AgentMessengerServiceLike;
}

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), {
    statusCode: 400,
  });
}

function parseMessengerProvider(value: string): "kakao" | "telegram" | "slack" | "discord" {
  if (value === "kakao" || value === "telegram" || value === "slack" || value === "discord") {
    return value;
  }

  throw badRequest("Unsupported messenger provider.");
}

function parseTelegramConnectionBody(body: unknown): {
  enabled?: boolean;
  botToken?: string | null;
  publicBaseUrl?: string | null;
  defaultAckText?: string | null;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Messenger connection body must be a JSON object.");
  }

  const input = body as Record<string, unknown>;
  const parsed: {
    enabled?: boolean;
    botToken?: string | null;
    publicBaseUrl?: string | null;
    defaultAckText?: string | null;
  } = {};

  if ("enabled" in input) {
    if (typeof input.enabled !== "boolean") {
      throw badRequest("enabled must be a boolean when provided.");
    }
    parsed.enabled = input.enabled;
  }

  for (const key of ["botToken", "publicBaseUrl", "defaultAckText"] as const) {
    if (!(key in input)) {
      continue;
    }

    const value = input[key];
    if (value === null || value === undefined) {
      parsed[key] = null;
      continue;
    }

    if (typeof value !== "string") {
      throw badRequest(`${key} must be a string when provided.`);
    }

    parsed[key] = value;
  }

  return parsed;
}

export const registerMessengerRoutes: FastifyPluginAsync<MessengerRoutesOptions> = async (
  server,
  options
) => {
  server.get("/agents/:agentId/messenger-connections", async (request, reply) => {
    const { agentId } = request.params as { agentId: string };

    sendJson(reply, 200, {
      slots: await options.agentMessengerService.listAgentMessengerSlots(agentId),
      updatedAt: new Date().toISOString(),
    });
  });

  server.put("/agents/:agentId/messenger-connections/:provider", async (request, reply) => {
    const { agentId, provider } = request.params as {
      agentId: string;
      provider: string;
    };
    const parsedProvider = parseMessengerProvider(provider);
    if (parsedProvider !== "telegram") {
      throw badRequest("Only Telegram messenger connections are configurable today.");
    }

    const record = await options.agentMessengerService.upsertTelegramConnection({
      agentId,
      provider: "telegram",
      ...parseTelegramConnectionBody(request.body),
    });
    sendJson(reply, 200, record);
  });

  server.delete("/agents/:agentId/messenger-connections/:provider", async (request, reply) => {
    const { agentId, provider } = request.params as {
      agentId: string;
      provider: string;
    };
    await options.agentMessengerService.deleteAgentMessengerConnection(
      agentId,
      parseMessengerProvider(provider)
    );
    reply.status(204).send();
  });
};
