import type { FastifyPluginAsync, FastifyPluginOptions } from "fastify";

import type { RuntimeRegistryLike } from "../api-types.js";
import { sendJson } from "../http/reply.js";

interface RuntimeRoutesOptions extends FastifyPluginOptions {
  runtimeRegistry: RuntimeRegistryLike;
}

export const registerRuntimeRoutes: FastifyPluginAsync<
  RuntimeRoutesOptions
> = async (server, options) => {
  server.get("/runtimes", async (_request, reply) => {
    sendJson(reply, 200, await options.runtimeRegistry.list());
  });
};
