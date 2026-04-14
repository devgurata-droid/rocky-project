---
name: rocky-runtime-probe
description: Verify Codex or Claude runtime flags against the locally installed CLI before changing model catalogs, service tiers, reasoning options, or runtime-to-UI mappings in this repository.
---

# Rocky Runtime Capability Probe

Use this skill when changing runtime-visible options such as:

- Codex or Claude model catalogs
- service tier / response speed mappings
- reasoning effort mappings
- CLI flag names or accepted literal values

## Rule

- Do not trust memory, docs, or past behavior for runtime literals.
- Treat the currently installed local CLI as the source of truth.
- UI `기본` options are allowed to mean `null` / omitted; they are not proof that a literal like `default` is accepted.

## Workflow

1. Print the local probe checklist before changing runtime mappings.

```bash
npm run runtime:probe -- --provider codex --write
```

2. Run each printed `codex exec` command as its own top-level terminal command.

- Do not batch the probe cases in a Node loop, shell loop, background job, or timeout wrapper.
- In this environment, wrapped `codex exec` invocations can panic or hang even when the direct top-level command succeeds.

3. Record the verified results under `.runtime/capabilities/`.

- Keep the installed CLI version in the note or checklist filename.
- Record whether the default behavior works only when the flag is omitted.
- Record which explicit values succeed or fail.

4. Only expose verified literals in UI and runtime code.

- If a probe case fails, do not ship that literal.
- If `기본` only works when omitted, map the UI option to `null` and make the command builder skip the flag.

5. Add or update regression tests.

- Command builder tests for the final argv
- Session hydration tests for legacy values
- Runtime catalog tests for supported options

## Notes

- The probe is intentionally a user-run harness, not part of the default CI loop.
- Current script support is implemented for Codex first. Extend the same pattern for Claude instead of guessing.
- The checklist generator is safe to automate. The actual `codex exec` probe cases are not.
- Reference command: `npm run runtime:probe -- --help`
