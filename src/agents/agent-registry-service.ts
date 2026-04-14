import { AgentManager } from "./agent-manager.js";

import type {
  AgentCreateInput,
  AgentRecord,
  AgentRegistryServiceOptions,
  AgentSessionOverrides,
  AgentUpdatePatch,
} from "./agent-types.js";
import type { RuntimeSessionInput } from "../runtime/runtime-types.js";

export class AgentRegistryService {
  private readonly manager;

  constructor(options: AgentRegistryServiceOptions = {}) {
    this.manager = options.manager ?? new AgentManager(options);
  }

  async createAgent(input: AgentCreateInput = {}): Promise<AgentRecord> {
    return this.manager.createAgent(input);
  }

  async getAgent(agentId: string): Promise<AgentRecord> {
    return this.manager.getAgent(agentId);
  }

  async listAgents(): Promise<AgentRecord[]> {
    return this.manager.listAgents();
  }

  async updateAgent(
    agentId: string,
    patch: AgentUpdatePatch = {}
  ): Promise<AgentRecord> {
    return this.manager.updateAgent(agentId, patch);
  }

  async deleteAgent(agentId: string): Promise<void> {
    return this.manager.deleteAgent(agentId);
  }

  async createCodexSession<T>(
    runtime: { createSession(input: RuntimeSessionInput): Promise<T> },
    agentOrId: string | AgentRecord,
    overrides: AgentSessionOverrides = {}
  ): Promise<T> {
    return this.manager.createRuntimeSession(runtime, agentOrId, overrides);
  }

  async createRuntimeSession<T>(
    runtime: { createSession(input: RuntimeSessionInput): Promise<T> },
    agentOrId: string | AgentRecord,
    overrides: AgentSessionOverrides = {}
  ): Promise<T> {
    return this.manager.createRuntimeSession(runtime, agentOrId, overrides);
  }
}
