import type { FastifyPluginAsync, FastifyPluginOptions } from "fastify";

import type { AuthProfileServiceLike } from "../../auth/auth-profile-types.js";
import { sendJson } from "../http/reply.js";

interface AuthProfileRoutesOptions extends FastifyPluginOptions {
  authProfileService: AuthProfileServiceLike;
}

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), {
    statusCode: 400,
  });
}

function parseCreateAuthProfileBody(body: unknown): {
  id?: string;
  name: string;
  accountLabel?: string | null;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object.");
  }

  const input = body as Record<string, unknown>;
  if (typeof input.name !== "string" || !input.name.trim()) {
    throw badRequest("A non-empty auth profile name is required.");
  }

  const parsed: {
    id?: string;
    name: string;
    accountLabel?: string | null;
  } = {
    name: input.name.trim(),
  };

  if ("id" in input) {
    if (typeof input.id !== "string" || !input.id.trim()) {
      throw badRequest("Auth profile id must be a non-empty string when provided.");
    }

    parsed.id = input.id.trim();
  }

  if ("accountLabel" in input) {
    if (input.accountLabel === null || input.accountLabel === undefined) {
      parsed.accountLabel = null;
    } else if (typeof input.accountLabel === "string") {
      parsed.accountLabel = input.accountLabel.trim() || null;
    } else {
      throw badRequest("accountLabel must be a string when provided.");
    }
  }

  return parsed;
}

function parseUpdateAuthProfileBody(body: unknown): {
  name?: string;
  accountLabel?: string | null;
  lifecycle?: "active" | "archived";
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object.");
  }

  const input = body as Record<string, unknown>;
  const parsed: {
    name?: string;
    accountLabel?: string | null;
    lifecycle?: "active" | "archived";
  } = {};

  if ("name" in input) {
    if (typeof input.name !== "string" || !input.name.trim()) {
      throw badRequest("Auth profile name must be a non-empty string.");
    }

    parsed.name = input.name.trim();
  }

  if ("accountLabel" in input) {
    if (input.accountLabel === null || input.accountLabel === undefined) {
      parsed.accountLabel = null;
    } else if (typeof input.accountLabel === "string") {
      parsed.accountLabel = input.accountLabel.trim() || null;
    } else {
      throw badRequest("accountLabel must be a string when provided.");
    }
  }

  if ("lifecycle" in input) {
    if (input.lifecycle === "active" || input.lifecycle === "archived") {
      parsed.lifecycle = input.lifecycle;
    } else {
      throw badRequest("Auth profile lifecycle must be active or archived.");
    }
  }

  if (
    !Object.prototype.hasOwnProperty.call(parsed, "name") &&
    !Object.prototype.hasOwnProperty.call(parsed, "accountLabel") &&
    !Object.prototype.hasOwnProperty.call(parsed, "lifecycle")
  ) {
    throw badRequest(
      "auth-profiles/:id requires a supported name, accountLabel, or lifecycle change."
    );
  }

  return parsed;
}

function parseIncludeArchivedQuery(query: unknown): boolean {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    return false;
  }

  const value = (query as Record<string, unknown>).includeArchived;
  if (value === undefined) {
    return false;
  }

  if (typeof value !== "string") {
    throw badRequest("includeArchived must be a boolean query string.");
  }

  if (value === "true" || value === "1") {
    return true;
  }

  if (value === "false" || value === "0") {
    return false;
  }

  throw badRequest("includeArchived must be true or false when provided.");
}

export const registerAuthProfileRoutes: FastifyPluginAsync<
  AuthProfileRoutesOptions
> = async (server, options) => {
  server.post("/auth-profiles", async (request, reply) => {
    const created = await options.authProfileService.createProfile(
      parseCreateAuthProfileBody(request.body)
    );
    sendJson(reply, 201, created);
  });

  server.get("/auth-profiles", async (request, reply) => {
    sendJson(
      reply,
      200,
      await options.authProfileService.listProfiles({
        includeArchived: parseIncludeArchivedQuery(request.query),
      })
    );
  });

  server.get("/auth-profiles/:authProfileId", async (request, reply) => {
    const { authProfileId } = request.params as { authProfileId: string };
    sendJson(reply, 200, await options.authProfileService.getProfile(authProfileId));
  });

  server.patch("/auth-profiles/:authProfileId", async (request, reply) => {
    const { authProfileId } = request.params as { authProfileId: string };
    sendJson(
      reply,
      200,
      await options.authProfileService.updateProfile({
        id: authProfileId,
        ...parseUpdateAuthProfileBody(request.body),
      })
    );
  });

  server.delete("/auth-profiles/:authProfileId", async (request, reply) => {
    const { authProfileId } = request.params as { authProfileId: string };
    await options.authProfileService.deleteProfile(authProfileId);
    reply.status(204).send();
  });
};
