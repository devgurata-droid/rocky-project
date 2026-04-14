#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  scripts/run-service-account-serve.sh [options]

Options:
  --check                     Print the derived service-account environment and exit.
  --home <path>               Service HOME. Defaults to $AGENT_ENGINE_HOME or $HOME.
  --toolchain-bin <path>      Prepend a shared bin directory (for node/codex) to PATH.
  --state-root <path>         Service state root. Defaults to $AGENT_ENGINE_STATE_ROOT or /var/lib/agent-engine.
  --host <value>              HTTP bind host. Defaults to $AGENT_ENGINE_HOST or 127.0.0.1.
  --port <value>              HTTP bind port. Defaults to $AGENT_ENGINE_PORT or 3000.
  --node-bin <path>           Node binary or command. Defaults to $AGENT_ENGINE_NODE_BIN or node.
  --cli-path <path>           Built CLI entrypoint. Defaults to $AGENT_ENGINE_CLI_PATH or dist/src/cli.js.
  -h, --help                  Show this help.

Environment:
  AGENT_ENGINE_HOME
  AGENT_ENGINE_TOOLCHAIN_BIN
  AGENT_ENGINE_STATE_ROOT
  AGENT_ENGINE_HOST
  AGENT_ENGINE_PORT
  AGENT_ENGINE_NODE_BIN
  AGENT_ENGINE_CLI_PATH

Examples:
  sudo -u agent-engine -H env \
    AGENT_ENGINE_HOME=/home/agent-engine \
    AGENT_ENGINE_TOOLCHAIN_BIN=/home/agent-engine/n/bin \
    AGENT_ENGINE_STATE_ROOT=/var/lib/agent-engine \
    /home/agent-engine/rocky-project/scripts/run-service-account-serve.sh --check

  sudo -u agent-engine -H env \
    AGENT_ENGINE_HOME=/home/agent-engine \
    AGENT_ENGINE_TOOLCHAIN_BIN=/home/agent-engine/n/bin \
    AGENT_ENGINE_STATE_ROOT=/var/lib/agent-engine \
    AGENT_ENGINE_HOST=0.0.0.0 \
    AGENT_ENGINE_PORT=3000 \
    /home/agent-engine/rocky-project/scripts/run-service-account-serve.sh
EOF
}

fail() {
  printf 'service-account-serve: %s\n' "$1" >&2
  exit 1
}

resolve_command_path() {
  local candidate="$1"
  if [[ "$candidate" == */* ]]; then
    [[ -x "$candidate" ]] || fail "Command is not executable: $candidate"
    printf '%s\n' "$candidate"
    return 0
  fi

  command -v "$candidate" >/dev/null 2>&1 || fail "Command not found in PATH: $candidate"
  command -v "$candidate"
}

CHECK_ONLY=0
SERVICE_HOME="${AGENT_ENGINE_HOME:-${HOME:-}}"
TOOLCHAIN_BIN="${AGENT_ENGINE_TOOLCHAIN_BIN:-}"
STATE_ROOT="${AGENT_ENGINE_STATE_ROOT:-/var/lib/agent-engine}"
HOST="${AGENT_ENGINE_HOST:-127.0.0.1}"
PORT="${AGENT_ENGINE_PORT:-3000}"
NODE_BIN="${AGENT_ENGINE_NODE_BIN:-node}"
CLI_PATH="${AGENT_ENGINE_CLI_PATH:-$REPO_ROOT/dist/src/cli.js}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      CHECK_ONLY=1
      shift
      ;;
    --home)
      [[ $# -ge 2 ]] || fail "--home requires a value"
      SERVICE_HOME="$2"
      shift 2
      ;;
    --toolchain-bin)
      [[ $# -ge 2 ]] || fail "--toolchain-bin requires a value"
      TOOLCHAIN_BIN="$2"
      shift 2
      ;;
    --state-root)
      [[ $# -ge 2 ]] || fail "--state-root requires a value"
      STATE_ROOT="$2"
      shift 2
      ;;
    --host)
      [[ $# -ge 2 ]] || fail "--host requires a value"
      HOST="$2"
      shift 2
      ;;
    --port)
      [[ $# -ge 2 ]] || fail "--port requires a value"
      PORT="$2"
      shift 2
      ;;
    --node-bin)
      [[ $# -ge 2 ]] || fail "--node-bin requires a value"
      NODE_BIN="$2"
      shift 2
      ;;
    --cli-path)
      [[ $# -ge 2 ]] || fail "--cli-path requires a value"
      CLI_PATH="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

[[ -n "$SERVICE_HOME" ]] || fail "Service HOME is required. Set --home or AGENT_ENGINE_HOME."

SYSTEM_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

if [[ -n "$TOOLCHAIN_BIN" ]]; then
  [[ -d "$TOOLCHAIN_BIN" ]] || fail "Toolchain bin directory does not exist: $TOOLCHAIN_BIN"
  export PATH="$TOOLCHAIN_BIN:$SYSTEM_PATH"
elif [[ -z "${PATH:-}" ]]; then
  export PATH="$SYSTEM_PATH"
fi

export HOME="$SERVICE_HOME"

[[ -d "$HOME" ]] || fail "Service HOME directory does not exist: $HOME"

if [[ ! "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 0 || PORT > 65535 )); then
  fail "Port must be an integer between 0 and 65535: $PORT"
fi

NODE_PATH="$(resolve_command_path "$NODE_BIN")"
CODEX_PATH="$(resolve_command_path codex)"
[[ -f "$CLI_PATH" ]] || fail "Built CLI entrypoint not found: $CLI_PATH"

if [[ "$CHECK_ONLY" == "1" ]]; then
  printf 'service_home=%s\n' "$HOME"
  printf 'state_root=%s\n' "$STATE_ROOT"
  printf 'host=%s\n' "$HOST"
  printf 'port=%s\n' "$PORT"
  printf 'node=%s\n' "$NODE_PATH"
  printf 'codex=%s\n' "$CODEX_PATH"
  printf 'cli=%s\n' "$CLI_PATH"
  printf 'path=%s\n' "$PATH"
  if [[ -d "$STATE_ROOT" ]]; then
    printf 'state_root_exists=true\n'
  else
    printf 'state_root_exists=false\n'
  fi
  exit 0
fi

mkdir -p "$STATE_ROOT"

exec "$NODE_PATH" "$CLI_PATH" serve \
  --state-root "$STATE_ROOT" \
  --host "$HOST" \
  --port "$PORT"
