import type { FastifyReply } from "fastify";

export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
export const SSE_CONTENT_TYPE = "text/event-stream; charset=utf-8";

export function sendJson(
  reply: FastifyReply,
  statusCode: number,
  value: unknown
): void {
  reply.code(statusCode).type(JSON_CONTENT_TYPE).send(value);
}
