import { AgentEngineClient } from "./agent-engine-client";

function resolveBaseUrl(): string {
  const configured = import.meta.env.VITE_AGENT_ENGINE_BASE_URL;
  return typeof configured === "string" && configured.trim()
    ? configured.trim()
    : "/api";
}

export const agentEngineClient = new AgentEngineClient(resolveBaseUrl());
