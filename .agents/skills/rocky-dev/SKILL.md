---
name: rocky-dev
description: Build and validate the Rocky runtime and backend in this repository. Use when implementing RuntimeAdapter or CodexCliRuntime flows, session/run or task automation layers, editing this repo's TypeScript/Node build-test workflow, updating repository guidance, or running the Node test and smoke checks for this codebase.
---

# Rocky Dev

## Goal

- Keep this repository focused on the Rocky runtime and backend platform.
- Implement new execution features behind runtime abstractions instead of binding product logic directly to `codex-cli`.
- Use a small, repeatable validation loop while the platform is still early-stage.
- Build forward from the completed runtime foundation into agent bootstrap and session layers without collapsing the engine boundary.

## Current Repository Baseline

- Treat `develop` as the integration base branch. Do not use `main` as the active baseline for new work.
- This is a `Node >=22` + TypeScript repo compiled with `tsc` and `moduleResolution: NodeNext`.
- Keep `.js` import specifiers in TypeScript source files so the emitted `dist/` tree runs under Node without post-processing.
- The first runtime is `CodexCliRuntime`, but the platform contract must stay centered on `RuntimeAdapter`.
- The `RuntimeAdapter` foundation is already in place.
- Current implementation slices focus on agent bootstrap/registry and agent session plus streaming flow.
- Workspaces are folder-based analysis spaces; Git repositories are optional and should not be assumed by default.
- The repository test loop runs compiled JavaScript from `dist/` with the built-in `node:test` runner, not `ts-node`, Vitest, or Jest.
- Define repository CI explicitly when CI work starts.
- Existing local skills cover Git safety separately; use this skill for product-development flow, not for generic Git work.

## Development Workflow

1. Read the current repository guidance before changing architecture-heavy code.
- Start with `README.md`.
- Read `src/runtime/runtime-adapter.ts` and `src/runtime/runtime-types.ts` before changing runtime contracts or result models.
- Keep new runtime or orchestration decisions aligned with later support for `CodexSdkRuntime` or `LangGraphRuntime`.

2. Preserve engine boundaries.
- Runtime-specific process spawning, event parsing, and environment setup stay under `src/runtime/`.
- Session, task, automation, or API-facing logic should depend on the runtime interface, not on raw `codex` command assembly.
- Prefer additive changes over leaking `codex-cli` assumptions into higher layers.
- Keep the runtime usable for non-git analysis folders; `skip-git-repo-check` should be treated as the default runtime posture unless a later feature requires repository-only behavior.
- Validate Codex CLI option compatibility per command shape; `exec` and `exec resume` do not always accept the same flags.
- When changing runtime literals that surface in product UI, first use the `rocky-runtime-probe` skill or run `npm run runtime:probe -- --provider codex --write`, then execute the printed `codex exec` probe cases one by one as top-level commands.

3. Follow the repository's TypeScript conventions.
- Add new code under `src/` and tests under `test/agents`, `test/api`, or `test/runtime` to match the existing split.
- When tests depend on non-TypeScript assets, update the build script so those assets are copied into `dist/` before `node --test` runs.
- Prefer the built-in Node test runner APIs (`node:test`, `node:assert/strict`) over adding a second test framework.
- For CLI or HTTP end-to-end checks, spawn `dist/src/cli.js` and fake `codex` through `PATH` before reaching for live networked smoke runs.

4. Validate in layers.
- Run `npm run typecheck` for fast TypeScript sanity.
- Run `npm test` for fast unit coverage.
- Run `npm run test:e2e` when changing CLI, HTTP, or session/resume flows and you want the compiled end-to-end path without a live Codex dependency.
- Run `npm run runtime:probe -- --provider codex --write` before changing Codex model, reasoning, or service-tier mappings, then execute the printed probe commands individually and record the result under `.runtime/capabilities/`.
- Run `npm run smoke -- --prompt "Reply with exactly OK"` when you need a user-executable live check against Codex.
- The smoke script defaults to isolated state under `.runtime/manual-smoke` and `read-only` sandbox mode.
- `tsconfig.json` is currently not strict, so passing typecheck is necessary but not sufficient; keep behavior changes covered by tests.
- When CI work begins, keep the local checks aligned with the repository's committed CI configuration.

5. Keep repository guidance in sync with implementation.
- Update `README.md` when you add a new recurring developer check or change the repository layout.
- Capture stable interface notes close to the owning code when a separate design document does not exist.
- Keep rollout notes narrow and colocated with the change until the repository grows a dedicated documentation structure again.

## Quick Commands

```bash
npm test
npm run test:e2e
npm run typecheck
npm run smoke -- --prompt "Reply with exactly OK"
git fetch origin develop
git switch develop
git merge --ff-only origin/develop
git switch -c feature/<topic>
```

## Notes

- A sandboxed smoke run can fail on network-restricted environments even when the runtime code is correct; rerun unrestricted only when you are intentionally validating the live Codex path.
- For manual live checks, prefer state roots under `.runtime/` instead of `/tmp`; current Codex builds can warn or degrade when helper binaries must be created under `/tmp`.
- For isolated agent runtime homes, seed both `~/.codex/auth.json` and `~/.codex/config.toml`, then ensure the current `workspaceRoot` is marked trusted in the runtime-home config. Auth-only seeding can make `workspace-write` runs behave like read-only sessions.
- For Codex status or usage features, read `model` and `model_reasoning_effort` from `~/.codex/config.toml`, then scan every `~/.codex/sessions/**/*.jsonl` file and pick the newest `token_count.rate_limits` event by its event timestamp. Do not assume the newest filename contains the freshest usage snapshot; resumed sessions can append newer events to older rollout files.
- Treat non-interactive `codex exec` as having no human approver. Normalize approval policies like `on-request` to `never` before spawning the runtime command, or shell writes can dead-end even when the sandbox is writable.
- When a live run claims a file write failed, inspect the persisted raw events before trusting the assistant text. The useful split is: no `command_execution` means the model only inferred failure, while a real `command_execution` with stderr is an actual runtime failure.
- If a first-turn Codex run succeeds but resume fails, inspect the exact `exec resume` argv before assuming the session model is wrong.
- Keep generated or transient runtime state under `.runtime/` and out of commits.
