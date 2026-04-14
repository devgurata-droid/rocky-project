import type { FastifyReply } from "fastify";

import type { RuntimeEvent } from "../../runtime/runtime-types.js";
import { SSE_CONTENT_TYPE } from "./reply.js";

function writeSseEvent(
  reply: FastifyReply,
  event: RuntimeEvent
): void {
  const response = reply.raw;
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

export async function streamRunEventsAsSse(
  reply: FastifyReply,
  stream: AsyncIterable<RuntimeEvent>
): Promise<void> {
  reply.hijack();
  const response = reply.raw;
  response.statusCode = 200;
  response.setHeader("Content-Type", SSE_CONTENT_TYPE);
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders?.();

  try {
    for await (const event of stream) {
      if (response.writableEnded || response.destroyed) {
        break;
      }

      writeSseEvent(reply, event);
    }

    if (!response.writableEnded) {
      response.end();
    }
  } catch (error) {
    if (!response.writableEnded) {
      response.write("event: error\n");
      response.write(
        `data: ${JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        })}\n\n`
      );
      response.end();
    }
  }
}
