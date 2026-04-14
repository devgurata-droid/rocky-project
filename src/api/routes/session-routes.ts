import type { FastifyPluginAsync, FastifyPluginOptions } from "fastify";

import type { SessionServiceLike } from "../api-types.js";
import { sendJson } from "../http/reply.js";
import type {
  RuntimeKind,
  RuntimeOllamaLaunchTarget,
  RuntimeReasoningEffort,
  RuntimeServiceTier,
} from "../../runtime/runtime-types.js";
import {
  normalizeRuntimeOllamaLaunchTarget,
  normalizeRuntimeServiceTier,
} from "../../runtime/runtime-types.js";

interface SessionRoutesOptions extends FastifyPluginOptions {
  sessionService: SessionServiceLike;
}

function isRuntimeKind(value: unknown): value is RuntimeKind {
  return value === "codex-cli" || value === "claude-code" || value === "ollama";
}

function parseOllamaLaunchTarget(
  value: unknown
): RuntimeOllamaLaunchTarget | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || !value.trim()) {
    throw badRequest("ollamaLaunchTarget must be codex or claude when provided.");
  }

  const normalized = normalizeRuntimeOllamaLaunchTarget(value.trim());
  if (!normalized) {
    throw badRequest("ollamaLaunchTarget must be codex or claude when provided.");
  }

  return normalized;
}

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), {
    statusCode: 400,
  });
}

function parseSessionPatchBody(body: unknown): {
  title?: string | null;
  lifecycle?: "active" | "archived";
  authProfileId?: string | null;
  model?: string | null;
  reasoningEffort?: RuntimeReasoningEffort | null;
  serviceTier?: RuntimeServiceTier | null;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object.");
  }

  const input = body as Record<string, unknown>;
  const parsed: {
    title?: string | null;
    lifecycle?: "active" | "archived";
    authProfileId?: string | null;
    model?: string | null;
    reasoningEffort?: RuntimeReasoningEffort | null;
    serviceTier?: RuntimeServiceTier | null;
  } = {};

  if ("title" in input) {
    if (input.title === null || input.title === undefined) {
      parsed.title = null;
    } else if (typeof input.title === "string") {
      const trimmed = input.title.trim();
      parsed.title = trimmed.length > 0 ? trimmed : null;
    } else {
      throw badRequest("Session title must be a string when provided.");
    }
  }

  if ("lifecycle" in input) {
    if (input.lifecycle === "active" || input.lifecycle === "archived") {
      parsed.lifecycle = input.lifecycle;
    } else {
      throw badRequest("Session lifecycle must be active or archived.");
    }
  }

  if ("authProfileId" in input) {
    if (input.authProfileId === null || input.authProfileId === undefined) {
      parsed.authProfileId = null;
    } else if (
      typeof input.authProfileId === "string" &&
      input.authProfileId.trim()
    ) {
      parsed.authProfileId = input.authProfileId.trim();
    } else {
      throw badRequest("authProfileId must be a non-empty string when provided.");
    }
  }

  if ("model" in input) {
    if (input.model === null || input.model === undefined) {
      parsed.model = null;
    } else if (typeof input.model === "string") {
      const trimmed = input.model.trim();
      parsed.model = trimmed.length > 0 ? trimmed : null;
    } else {
      throw badRequest("model must be a string when provided.");
    }
  }

  if ("reasoningEffort" in input) {
    if (input.reasoningEffort === null || input.reasoningEffort === undefined) {
      parsed.reasoningEffort = null;
    } else if (typeof input.reasoningEffort === "string") {
      const trimmed = input.reasoningEffort.trim();
      parsed.reasoningEffort = (trimmed.length > 0 ? trimmed : null) as
        | RuntimeReasoningEffort
        | null;
    } else {
      throw badRequest("reasoningEffort must be a string when provided.");
    }
  }

  if ("serviceTier" in input) {
    if (input.serviceTier === null || input.serviceTier === undefined) {
      parsed.serviceTier = null;
    } else if (typeof input.serviceTier === "string") {
      const trimmed = input.serviceTier.trim();
      if (trimmed.length === 0) {
        parsed.serviceTier = null;
      } else if (trimmed === "default" || trimmed === "flex") {
        parsed.serviceTier = null;
      } else {
        const normalized = normalizeRuntimeServiceTier(trimmed);
        if (!normalized) {
          throw badRequest("serviceTier must be fast when provided.");
        }
        parsed.serviceTier = normalized;
      }
    } else {
      throw badRequest("serviceTier must be a string when provided.");
    }
  }

  if (
    !("title" in parsed) &&
    !("lifecycle" in parsed) &&
    !("authProfileId" in parsed) &&
    !("model" in parsed) &&
    !("reasoningEffort" in parsed) &&
    !("serviceTier" in parsed)
  ) {
    throw badRequest(
      "sessions/:id requires a title, lifecycle, authProfileId, model, reasoningEffort, and/or serviceTier change."
    );
  }

  return parsed;
}

function parseStopRunningRunsQuery(query: unknown): boolean {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    return false;
  }

  const value = (query as Record<string, unknown>).stopRunningRuns;
  if (value === undefined) {
    return false;
  }

  if (typeof value !== "string") {
    throw badRequest("stopRunningRuns must be a boolean query string.");
  }

  if (value === "true" || value === "1") {
    return true;
  }

  if (value === "false" || value === "0") {
    return false;
  }

  throw badRequest("stopRunningRuns must be true or false when provided.");
}

function parseSendMessageBody(body: unknown): {
  prompt: string;
  images?: string[];
  runtimeKind?: RuntimeKind;
  ollamaLaunchTarget?: RuntimeOllamaLaunchTarget | null;
  model?: string | null;
  reasoningEffort?: RuntimeReasoningEffort | null;
  serviceTier?: RuntimeServiceTier | null;
  reuseMessageId?: string;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("sessions/:id/messages requires a JSON object body.");
  }

  const input = body as Record<string, unknown>;
  if (typeof input.prompt !== "string" || !input.prompt.trim()) {
    throw badRequest("sessions/:id/messages requires a non-empty prompt.");
  }

  let images: string[] | undefined;
  if ("images" in input && input.images !== null && input.images !== undefined) {
    if (!Array.isArray(input.images)) {
      throw badRequest("images must be an array of workspace paths when provided.");
    }

    images = input.images.map((entry) => {
      if (typeof entry !== "string" || !entry.trim()) {
        throw badRequest("images entries must be non-empty strings.");
      }

      return entry.trim();
    });
  }

  let runtimeKind: RuntimeKind | undefined;
  if ("runtimeKind" in input) {
    if (input.runtimeKind === null || input.runtimeKind === undefined) {
      runtimeKind = undefined;
    } else if (isRuntimeKind(input.runtimeKind)) {
      runtimeKind = input.runtimeKind;
    } else {
      throw badRequest(
        "runtimeKind must be codex-cli, claude-code, or ollama when provided."
      );
    }
  }

  const ollamaLaunchTarget = parseOllamaLaunchTarget(input.ollamaLaunchTarget);

  let model: string | null | undefined;
  if ("model" in input) {
    if (input.model === null || input.model === undefined) {
      model = null;
    } else if (typeof input.model === "string") {
      const trimmed = input.model.trim();
      model = trimmed.length > 0 ? trimmed : null;
    } else {
      throw badRequest("model must be a string when provided.");
    }
  }

  let reasoningEffort: RuntimeReasoningEffort | null | undefined;
  if ("reasoningEffort" in input) {
    if (input.reasoningEffort === null || input.reasoningEffort === undefined) {
      reasoningEffort = null;
    } else if (typeof input.reasoningEffort === "string") {
      const trimmed = input.reasoningEffort.trim();
      reasoningEffort = (trimmed.length > 0 ? trimmed : null) as
        | RuntimeReasoningEffort
        | null;
    } else {
      throw badRequest("reasoningEffort must be a string when provided.");
    }
  }

  let serviceTier: RuntimeServiceTier | null | undefined;
  if ("serviceTier" in input) {
    if (input.serviceTier === null || input.serviceTier === undefined) {
      serviceTier = null;
    } else if (typeof input.serviceTier === "string") {
      const trimmed = input.serviceTier.trim();
      if (trimmed.length === 0 || trimmed === "default" || trimmed === "flex") {
        serviceTier = null;
      } else {
        const normalized = normalizeRuntimeServiceTier(trimmed);
        if (!normalized) {
          throw badRequest("serviceTier must be fast when provided.");
        }
        serviceTier = normalized;
      }
    } else {
      throw badRequest("serviceTier must be a string when provided.");
    }
  }

  let reuseMessageId: string | undefined;
  if ("reuseMessageId" in input) {
    if (typeof input.reuseMessageId !== "string" || !input.reuseMessageId.trim()) {
      throw badRequest("reuseMessageId must be a non-empty string when provided.");
    }

    reuseMessageId = input.reuseMessageId.trim();
  }

  return {
    prompt: input.prompt.trim(),
    images,
    runtimeKind,
    ollamaLaunchTarget,
    model,
    reasoningEffort,
    serviceTier,
    reuseMessageId,
  };
}

export const registerSessionRoutes: FastifyPluginAsync<SessionRoutesOptions> = async (
  server,
  options
) => {
  server.get("/sessions/:sessionId", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    sendJson(reply, 200, await options.sessionService.getSession(sessionId));
  });

  server.get("/sessions/:sessionId/transcript", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    sendJson(reply, 200, await options.sessionService.getTranscript(sessionId));
  });

  server.delete("/sessions/:sessionId", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (parseStopRunningRunsQuery(request.query)) {
      await options.sessionService.stopSessionRuns(sessionId);
    }
    await options.sessionService.deleteSession(sessionId);
    reply.status(204).send();
  });

  server.patch("/sessions/:sessionId", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const updated = await options.sessionService.updateSession({
      sessionId,
      ...parseSessionPatchBody(request.body),
    });

    sendJson(reply, 200, updated);
  });

  server.post("/sessions/:sessionId/messages", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = parseSendMessageBody(request.body);

    const run = await options.sessionService.sendTurn({
      sessionId,
      prompt: body.prompt,
      images: body.images,
      runtimeKind: body.runtimeKind,
      ollamaLaunchTarget: body.ollamaLaunchTarget,
      model: body.model,
      reasoningEffort: body.reasoningEffort,
      serviceTier: body.serviceTier,
      reuseMessageId: body.reuseMessageId,
    });
    sendJson(reply, 202, run);
  });
};
