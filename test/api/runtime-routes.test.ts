import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import { createAgentEngineServer } from "../../src/api/agent-engine-server.js";
import { createDefaultRuntimeRegistry } from "../../src/runtime/runtime-registry.js";
import { OllamaModelCatalog } from "../../src/runtime/ollama-model-catalog.js";

test("runtime routes expose supported CLI engines and model catalogs", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "runtime-routes-"));
  const runtimeRegistry = createDefaultRuntimeRegistry(process.env, {
    ollamaCatalog: new OllamaModelCatalog({
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            models: [
              {
                model: "codex:latest",
              },
              {
                model: "qwen2.5-coder:7b",
              },
            ],
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          }
        ),
    }),
  });
  const server = createAgentEngineServer({
    stateRoot,
    runtimeRegistry,
  });

  await server.listen({
    host: "127.0.0.1",
    port: 0,
  });

  try {
    const address = server.server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const response = await fetch(`${baseUrl}/runtimes`);
    assert.equal(response.status, 200);

    const runtimes = await response.json() as Array<{
      kind: string;
      provider: string;
      defaultModel: string | null;
      modelOptions: Array<{
        id: string;
        supportedReasoningEfforts: string[];
        defaultReasoningEffort: string | null;
        supportedServiceTiers: string[];
        defaultServiceTier: string | null;
      }>;
    }>;

    assert.deepEqual(
      runtimes.map((runtime) => runtime.kind),
      ["codex-cli", "claude-code", "ollama"]
    );
    assert.equal(runtimes[0]?.provider, "codex");
    assert.equal(runtimes[1]?.provider, "claude");
    assert.equal(runtimes[2]?.provider, "ollama");
    assert.equal(runtimes[0]?.defaultModel, "gpt-5.4");
    assert.equal(runtimes[1]?.defaultModel, "default");
    assert.equal(runtimes[2]?.defaultModel, "codex:latest");
    assert.ok(runtimes[0]?.modelOptions.some((model) => model.id === "gpt-5.4-mini"));
    assert.ok(runtimes[1]?.modelOptions.some((model) => model.id === "opus"));
    assert.ok(runtimes[2]?.modelOptions.some((model) => model.id === "qwen2.5-coder:7b"));
    assert.deepEqual(
      runtimes[0]?.modelOptions.find((model) => model.id === "gpt-5.4")?.supportedReasoningEfforts,
      ["low", "medium", "high", "xhigh"]
    );
    assert.equal(
      runtimes[0]?.modelOptions.find((model) => model.id === "gpt-5.4")?.defaultServiceTier,
      null
    );
    assert.deepEqual(
      runtimes[0]?.modelOptions.find((model) => model.id === "gpt-5.4")?.supportedServiceTiers,
      ["fast"]
    );
    assert.deepEqual(
      runtimes[1]?.modelOptions.find((model) => model.id === "default")?.supportedReasoningEfforts,
      ["low", "medium", "high", "max"]
    );
    assert.deepEqual(
      runtimes[2]?.modelOptions.find((model) => model.id === "codex:latest")?.supportedReasoningEfforts,
      []
    );
  } finally {
    await server.close();
  }
});
