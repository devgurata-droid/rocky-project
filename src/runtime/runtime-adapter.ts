import type {
  RuntimeCapabilities,
  RuntimeEvent,
  RuntimeRunResult,
  RuntimeRunStart,
  RuntimeSession,
  RuntimeSessionInput,
  RuntimeRequest,
} from "./runtime-types.js";

export const DEFAULT_RUNTIME_CAPABILITIES: Readonly<RuntimeCapabilities> =
  Object.freeze({
    streaming: false,
    resumeSession: false,
    shellExecution: false,
    fileMutation: false,
    approvalFlow: false,
    durableSessionState: false,
    structuredEvents: false,
    skillInjection: false,
  });

export abstract class RuntimeAdapter {
  abstract createSession(input: RuntimeSessionInput): Promise<RuntimeSession>;

  abstract sendTurn(input: RuntimeRequest): Promise<RuntimeRunStart>;

  abstract resumeSession(input: RuntimeRequest): Promise<RuntimeRunStart>;

  abstract streamEvents(runId: string): AsyncIterable<RuntimeEvent>;

  abstract cancelRun(runId: string): Promise<void>;

  abstract getRunResult(runId: string): Promise<RuntimeRunResult>;

  listCapabilities(): Readonly<RuntimeCapabilities> {
    return DEFAULT_RUNTIME_CAPABILITIES;
  }
}
