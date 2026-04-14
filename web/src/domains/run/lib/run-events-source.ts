import { agentEngineClient } from "@/shared/lib/api-client";
import type { RuntimeEvent } from "../types";

const RUNTIME_EVENT_TYPES = [
  "session.bound",
  "run.started",
  "run.warning",
  "run.error",
  "assistant.message.delta",
  "assistant.message.completed",
  "run.stdout",
  "run.stderr",
  "run.raw",
  "run.completed",
] as const;

export class RunEventsSource {
  private readonly eventSource: EventSource;
  private readonly eventHandler: (message: MessageEvent<string>) => void;

  constructor(
    runId: string,
    callbacks: {
      onEvent: (event: RuntimeEvent) => void;
      onOpen?: () => void;
      onError?: (message?: string) => void;
    }
  ) {
    this.eventSource = new EventSource(agentEngineClient.runEventsUrl(runId));
    this.eventHandler = (message) => {
      try {
        callbacks.onEvent(JSON.parse(message.data) as RuntimeEvent);
      } catch (error) {
        callbacks.onError?.(
          error instanceof Error ? error.message : "Failed to parse runtime event."
        );
      }
    };
    this.eventSource.onopen = () => {
      callbacks.onOpen?.();
    };
    this.eventSource.onmessage = this.eventHandler;
    for (const eventType of RUNTIME_EVENT_TYPES) {
      this.eventSource.addEventListener(eventType, this.eventHandler as EventListener);
    }
    this.eventSource.onerror = () => {
      callbacks.onError?.();
    };
  }

  close(): void {
    for (const eventType of RUNTIME_EVENT_TYPES) {
      this.eventSource.removeEventListener(
        eventType,
        this.eventHandler as EventListener
      );
    }
    this.eventSource.close();
  }
}
