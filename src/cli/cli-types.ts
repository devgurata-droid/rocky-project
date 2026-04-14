import type {
  AgentCreateInput,
  AgentRecord,
  AgentRegistryServiceOptions,
  AgentUpdatePatch,
} from "../agents/agent-types.js";
import type {
  AgentServiceLike as HttpAgentServiceLike,
  SessionServiceLike,
} from "../api/api-types.js";

export type OutputWriter = {
  write(chunk: string): unknown;
};

export interface CliAgentServiceLike extends HttpAgentServiceLike {
  createAgent(input?: AgentCreateInput): Promise<AgentRecord>;
  updateAgent(agentId: string, patch?: AgentUpdatePatch): Promise<AgentRecord>;
}

export interface CliDependencies extends AgentRegistryServiceOptions {
  stdout?: OutputWriter;
  stderr?: OutputWriter;
  service?: CliAgentServiceLike;
  sessionService?: SessionServiceLike;
}

export interface CliOptionValues {
  "state-root"?: string;
  host?: string;
  port?: string;
  id?: string;
  name?: string;
  title?: string;
  description?: string;
  prompt?: string;
  stream?: boolean;
  "workspace-root"?: string;
  "runtime-home"?: string;
  runtime?: string;
  sandbox?: string;
  approval?: string;
  "model-profile"?: string;
  status?: string;
  uv?: boolean;
  help?: boolean;
}

export type CliResource = "serve" | "agent" | "session" | "run";

export interface CliContext {
  values: CliOptionValues;
  stdout: OutputWriter;
  stderr: OutputWriter;
  service: CliAgentServiceLike;
  sessionService: SessionServiceLike;
  dependencies: CliDependencies;
}
