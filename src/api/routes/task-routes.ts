import type { FastifyPluginAsync, FastifyPluginOptions } from "fastify";

import type { TaskServiceLike } from "../api-types.js";
import { sendJson } from "../http/reply.js";
import {
  normalizeRuntimeOllamaLaunchTarget,
  normalizeRuntimeServiceTier,
} from "../../runtime/runtime-types.js";
import type {
  RuntimeOllamaLaunchTarget,
  RuntimeReasoningEffort,
} from "../../runtime/runtime-types.js";

interface TaskRoutesOptions extends FastifyPluginOptions {
  taskService: TaskServiceLike;
}

function parseRuntimeKind(
  input: Record<string, unknown>
): "codex-cli" | "claude-code" | "ollama" | undefined {
  if (!Object.prototype.hasOwnProperty.call(input, "runtimeKind")) {
    return undefined;
  }

  if (
    input.runtimeKind === "codex-cli" ||
    input.runtimeKind === "claude-code" ||
    input.runtimeKind === "ollama"
  ) {
    return input.runtimeKind;
  }

  throw badRequest("runtimeKind must be codex-cli, claude-code, or ollama when provided.");
}

function parseServiceTier(
  input: Record<string, unknown>,
  field: string
): "fast" | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(input, field)) {
    return undefined;
  }

  const value = input[field];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw badRequest("serviceTier must be fast when provided.");
  }

  const normalized = normalizeRuntimeServiceTier(value.trim());
  if (!normalized) {
    throw badRequest("serviceTier must be fast when provided.");
  }

  return normalized;
}

function parseOllamaLaunchTarget(
  input: Record<string, unknown>
): RuntimeOllamaLaunchTarget | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(input, "ollamaLaunchTarget")) {
    return undefined;
  }

  const value = input.ollamaLaunchTarget;
  if (value === null || value === undefined) {
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

function parseReasoningEffort(
  input: Record<string, unknown>
): RuntimeReasoningEffort | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(input, "reasoningEffort")) {
    return undefined;
  }

  const value = input.reasoningEffort;
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw badRequest("reasoningEffort must be a non-empty string when provided.");
  }

  const normalized = value.trim();
  if (
    normalized !== "low" &&
    normalized !== "medium" &&
    normalized !== "high" &&
    normalized !== "xhigh" &&
    normalized !== "max"
  ) {
    throw badRequest("reasoningEffort must be low, medium, high, xhigh, or max.");
  }

  return normalized;
}

function parseLifecycle(
  input: Record<string, unknown>
): "active" | "archived" | undefined {
  if (!Object.prototype.hasOwnProperty.call(input, "lifecycle")) {
    return undefined;
  }

  if (input.lifecycle === "active" || input.lifecycle === "archived") {
    return input.lifecycle;
  }

  throw badRequest("lifecycle must be active or archived when provided.");
}

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), {
    statusCode: 400,
  });
}

function parseCreateTaskBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Task create requests require a JSON object body.");
  }

  const input = body as Record<string, unknown>;
  if (typeof input.name !== "string" || !input.name.trim()) {
    throw badRequest("Task name is required.");
  }
  if (typeof input.prompt !== "string" || !input.prompt.trim()) {
    throw badRequest("Task prompt is required.");
  }

  return {
    id:
      typeof input.id === "string" && input.id.trim()
        ? input.id.trim()
        : undefined,
    name: input.name.trim(),
    description:
      typeof input.description === "string" ? input.description : null,
    prompt: input.prompt.trim(),
    runtimeKind: parseRuntimeKind(input),
    ollamaLaunchTarget: parseOllamaLaunchTarget(input),
    model:
      input.model === null || input.model === undefined
        ? null
        : typeof input.model === "string" && input.model.trim()
          ? input.model.trim()
          : (() => {
              throw badRequest("model must be a non-empty string when provided.");
            })(),
    reasoningEffort: parseReasoningEffort(input),
    serviceTier: parseServiceTier(input, "serviceTier"),
    enabled: typeof input.enabled === "boolean" ? input.enabled : undefined,
    sourceSessionId:
      typeof input.sourceSessionId === "string" && input.sourceSessionId.trim()
        ? input.sourceSessionId.trim()
        : null,
    schedule:
      input.schedule && typeof input.schedule === "object" && !Array.isArray(input.schedule)
        ? {
            enabled:
              typeof (input.schedule as Record<string, unknown>).enabled === "boolean"
                ? ((input.schedule as Record<string, unknown>).enabled as boolean)
                : undefined,
            intervalMinutes:
              typeof (input.schedule as Record<string, unknown>).intervalMinutes === "number"
                ? ((input.schedule as Record<string, unknown>).intervalMinutes as number)
                : null,
          }
        : null,
    eventTrigger:
      input.eventTrigger &&
      typeof input.eventTrigger === "object" &&
      !Array.isArray(input.eventTrigger)
        ? {
            enabled:
              typeof (input.eventTrigger as Record<string, unknown>).enabled === "boolean"
                ? ((input.eventTrigger as Record<string, unknown>).enabled as boolean)
                : undefined,
          }
        : null,
    messengerDelivery: parseMessengerDelivery(input) ?? null,
  };
}

function parseUpdateTaskBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Task update requests require a JSON object body.");
  }

  const input = body as Record<string, unknown>;
  return {
    name:
      typeof input.name === "string" && input.name.trim()
        ? input.name.trim()
        : undefined,
    description:
      Object.prototype.hasOwnProperty.call(input, "description")
        ? typeof input.description === "string"
          ? input.description
          : null
        : undefined,
    prompt:
      typeof input.prompt === "string" && input.prompt.trim()
        ? input.prompt.trim()
        : undefined,
    runtimeKind: parseRuntimeKind(input),
    ollamaLaunchTarget: parseOllamaLaunchTarget(input),
    model:
      Object.prototype.hasOwnProperty.call(input, "model")
        ? input.model === null || input.model === undefined
          ? null
          : typeof input.model === "string" && input.model.trim()
            ? input.model.trim()
            : (() => {
                throw badRequest("model must be a non-empty string when provided.");
              })()
        : undefined,
    reasoningEffort: parseReasoningEffort(input),
    serviceTier: parseServiceTier(input, "serviceTier"),
    enabled: typeof input.enabled === "boolean" ? input.enabled : undefined,
    lifecycle: parseLifecycle(input),
    schedule:
      input.schedule && typeof input.schedule === "object" && !Array.isArray(input.schedule)
        ? {
            enabled:
              typeof (input.schedule as Record<string, unknown>).enabled === "boolean"
                ? ((input.schedule as Record<string, unknown>).enabled as boolean)
                : undefined,
            intervalMinutes:
              typeof (input.schedule as Record<string, unknown>).intervalMinutes === "number"
                ? ((input.schedule as Record<string, unknown>).intervalMinutes as number)
                : null,
          }
        : undefined,
    eventTrigger:
      input.eventTrigger &&
      typeof input.eventTrigger === "object" &&
      !Array.isArray(input.eventTrigger)
        ? {
            enabled:
              typeof (input.eventTrigger as Record<string, unknown>).enabled === "boolean"
                ? ((input.eventTrigger as Record<string, unknown>).enabled as boolean)
                : undefined,
            regenerateWebhookToken:
              (input.eventTrigger as Record<string, unknown>).regenerateWebhookToken === true,
          }
        : undefined,
    messengerDelivery: parseMessengerDelivery(input),
  };
}

function parseIncludeArchivedQuery(query: unknown): boolean {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    return false;
  }

  const value = (query as Record<string, unknown>).includeArchived;
  return value === "true" || value === "1";
}

function parseMessengerDelivery(
  input: Record<string, unknown>
): {
  enabled?: boolean;
  chatId?: string | null;
  threadId?: string | null;
} | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(input, "messengerDelivery")) {
    return undefined;
  }

  const value = input.messengerDelivery;
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw badRequest("messengerDelivery must be a JSON object when provided.");
  }

  const record = value as Record<string, unknown>;
  const parsed = {
    enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
    chatId:
      Object.prototype.hasOwnProperty.call(record, "chatId")
        ? record.chatId === null || record.chatId === undefined
          ? null
          : typeof record.chatId === "string"
            ? record.chatId
            : (() => {
                throw badRequest("messengerDelivery.chatId must be a string when provided.");
              })()
        : undefined,
    threadId:
      Object.prototype.hasOwnProperty.call(record, "threadId")
        ? record.threadId === null || record.threadId === undefined
          ? null
          : typeof record.threadId === "string"
            ? record.threadId
            : (() => {
                throw badRequest("messengerDelivery.threadId must be a string when provided.");
              })()
        : undefined,
  };

  if (parsed.enabled === true && (!parsed.chatId || !parsed.chatId.trim())) {
    throw badRequest("messengerDelivery.chatId is required when messenger delivery is enabled.");
  }

  return parsed;
}

export const registerTaskRoutes: FastifyPluginAsync<TaskRoutesOptions> = async (
  server,
  options
) => {
  server.get("/agents/:agentId/tasks", async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    sendJson(
      reply,
      200,
      await options.taskService.listAgentTasks(agentId, {
        includeArchived: parseIncludeArchivedQuery(request.query),
      })
    );
  });

  server.post("/agents/:agentId/tasks", async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    sendJson(reply, 201, await options.taskService.createTask(agentId, parseCreateTaskBody(request.body)));
  });

  server.get("/tasks/:taskId", async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    sendJson(reply, 200, await options.taskService.getTask(taskId));
  });

  server.patch("/tasks/:taskId", async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    sendJson(
      reply,
      200,
      await options.taskService.updateTask({
        taskId,
        ...parseUpdateTaskBody(request.body),
      })
    );
  });

  server.delete("/tasks/:taskId", async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    await options.taskService.deleteTask(taskId);
    reply.status(204).send();
  });

  server.get("/tasks/:taskId/runs", async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    sendJson(reply, 200, await options.taskService.listTaskRuns(taskId));
  });

  server.post("/tasks/:taskId/run", async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    sendJson(
      reply,
      202,
      await options.taskService.runTask({
        taskId,
        triggerType: "manual_task",
        triggerSource: "manual",
      })
    );
  });

  server.post("/tasks/events/:webhookToken", async (request, reply) => {
    const { webhookToken } = request.params as { webhookToken: string };
    sendJson(
      reply,
      202,
      await options.taskService.runTaskByWebhookToken(webhookToken, request.body ?? null)
    );
  });
};
