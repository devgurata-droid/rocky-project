#!/usr/bin/env bash

set -euo pipefail

provider="codex"
codex_bin="codex"
workdir="$(pwd)"
model="gpt-5.4-mini"
reasoning="low"
prompt="Reply with exactly OK."
write_template="false"
output_path=""

usage() {
  cat <<'EOF'
Usage: npm run runtime:probe -- [options]

This command prints a safe probe checklist for the locally installed Codex CLI.
In this repository, wrapped or batched `codex exec` invocations can panic or hang,
so each probe case must be run as its own top-level terminal command.

Options:
  --provider codex        Probe the local Codex CLI runtime capabilities
  --codex-bin <path>      Override the codex binary path
  --cwd <path>            Working directory to run the probe from
  --model <id>            Model id used for the probe (default: gpt-5.4-mini)
  --reasoning <level>     Reasoning effort used for the probe (default: low)
  --prompt <text>         Probe prompt (default: Reply with exactly OK.)
  --write                 Write a checklist template under .runtime/capabilities
  --output <path>         Custom output path when using --write
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --provider)
      provider="${2:-$provider}"
      shift 2
      ;;
    --codex-bin)
      codex_bin="${2:-$codex_bin}"
      shift 2
      ;;
    --cwd)
      workdir="${2:-$workdir}"
      shift 2
      ;;
    --model)
      model="${2:-$model}"
      shift 2
      ;;
    --reasoning)
      reasoning="${2:-$reasoning}"
      shift 2
      ;;
    --prompt)
      prompt="${2:-$prompt}"
      shift 2
      ;;
    --output)
      output_path="${2:-$output_path}"
      shift 2
      ;;
    --write)
      write_template="true"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ "$provider" != "codex" ]]; then
  echo "Unsupported provider: $provider. This probe currently supports only codex." >&2
  exit 1
fi

cd "$workdir"

cli_version="$("$codex_bin" --version | tr -d '\r')"
checked_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
slug="$(printf '%s' "$cli_version" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9._-]+/-/g; s/^-+//; s/-+$//')"

base_command="$codex_bin exec --json --skip-git-repo-check --sandbox read-only --ephemeral -m $model -c model_reasoning_effort=\"$reasoning\""

read -r -d '' checklist <<EOF || true
Runtime capability probe checklist

- Provider: codex
- CLI version: $cli_version
- Checked at (UTC): $checked_at
- Working directory: $(pwd)
- Note: run each command below as its own top-level terminal command.
- Note: do not wrap these commands in Node child_process, shell loops, background jobs, or timeout wrappers.

Commands

1. Omit service tier
$base_command "$prompt"

2. Explicit fast
$base_command -c service_tier="fast" "$prompt"

3. Explicit default
$base_command -c service_tier="default" "$prompt"

4. Explicit flex
$base_command -c service_tier="flex" "$prompt"

Expected recording template

- omit:
  - exit code:
  - observed result:
- fast:
  - exit code:
  - observed result:
- default:
  - exit code:
  - observed result:
- flex:
  - exit code:
  - observed result:

Decision rules

- Only ship literals that succeed in the current local CLI.
- If "기본" works only when the flag is omitted, map the UI option to null and skip the CLI flag.
- Record the final verified result in .runtime/capabilities/.
EOF

if [[ "$write_template" == "true" ]]; then
  if [[ -z "$output_path" ]]; then
    output_path="$(pwd)/.runtime/capabilities/${slug:-codex-cli}.md"
  fi

  mkdir -p "$(dirname "$output_path")"
  printf '%s\n' "$checklist" >"$output_path"
  printf 'Wrote checklist: %s\n\n' "$output_path"
fi

printf '%s\n' "$checklist"
