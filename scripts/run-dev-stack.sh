#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  scripts/run-dev-stack.sh [options]

Options:
  --check                     Print the derived settings and exit.
  --skip-install              Skip npm install checks.
  --skip-build                Skip the backend build step.
  --state-root <path>         Backend state root. Defaults to .runtime/agent-engine.
  --backend-host <value>      Backend bind host. Defaults to 127.0.0.1.
  --backend-port <value>      Backend bind port. Defaults to 3000.
  --web-host <value>          Frontend dev-server host. Defaults to 127.0.0.1.
  --web-port <value>          Frontend dev-server port. Defaults to 4173.
  -h, --help                  Show this help.

Environment:
  AGENT_ENGINE_STATE_ROOT
  AGENT_ENGINE_HOST
  AGENT_ENGINE_PORT
  AGENT_ENGINE_WEB_HOST
  AGENT_ENGINE_WEB_PORT

Examples:
  scripts/run-dev-stack.sh
  scripts/run-dev-stack.sh --state-root .runtime/dev-stack
  scripts/run-dev-stack.sh --backend-host 0.0.0.0 --web-host 0.0.0.0
EOF
}

fail() {
  printf 'run-dev-stack: %s\n' "$1" >&2
  exit 1
}

has_executable() {
  local path="$1"
  [[ -x "$path" ]]
}

root_dependencies_ready() {
  has_executable "$REPO_ROOT/node_modules/.bin/tsc"
}

web_dependencies_ready() {
  has_executable "$REPO_ROOT/web/node_modules/.bin/tsc" && \
    has_executable "$REPO_ROOT/web/node_modules/.bin/vite"
}

ensure_integer_port() {
  local label="$1"
  local value="$2"
  if [[ ! "$value" =~ ^[0-9]+$ ]] || (( value < 0 || value > 65535 )); then
    fail "$label must be an integer between 0 and 65535: $value"
  fi
}

CHECK_ONLY=0
SKIP_INSTALL=0
SKIP_BUILD=0
STATE_ROOT="${AGENT_ENGINE_STATE_ROOT:-.runtime/agent-engine}"
BACKEND_HOST="${AGENT_ENGINE_HOST:-127.0.0.1}"
BACKEND_PORT="${AGENT_ENGINE_PORT:-3000}"
WEB_HOST="${AGENT_ENGINE_WEB_HOST:-127.0.0.1}"
WEB_PORT="${AGENT_ENGINE_WEB_PORT:-4173}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      CHECK_ONLY=1
      shift
      ;;
    --skip-install)
      SKIP_INSTALL=1
      shift
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --state-root)
      [[ $# -ge 2 ]] || fail "--state-root requires a value"
      STATE_ROOT="$2"
      shift 2
      ;;
    --backend-host)
      [[ $# -ge 2 ]] || fail "--backend-host requires a value"
      BACKEND_HOST="$2"
      shift 2
      ;;
    --backend-port)
      [[ $# -ge 2 ]] || fail "--backend-port requires a value"
      BACKEND_PORT="$2"
      shift 2
      ;;
    --web-host)
      [[ $# -ge 2 ]] || fail "--web-host requires a value"
      WEB_HOST="$2"
      shift 2
      ;;
    --web-port)
      [[ $# -ge 2 ]] || fail "--web-port requires a value"
      WEB_PORT="$2"
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

ensure_integer_port "Backend port" "$BACKEND_PORT"
ensure_integer_port "Web port" "$WEB_PORT"

PROXY_TARGET_HOST="$BACKEND_HOST"
if [[ "$PROXY_TARGET_HOST" == "0.0.0.0" ]]; then
  PROXY_TARGET_HOST="127.0.0.1"
fi
PROXY_TARGET="http://$PROXY_TARGET_HOST:$BACKEND_PORT"

if [[ "$CHECK_ONLY" == "1" ]]; then
  printf 'repo_root=%s\n' "$REPO_ROOT"
  printf 'state_root=%s\n' "$STATE_ROOT"
  printf 'backend_host=%s\n' "$BACKEND_HOST"
  printf 'backend_port=%s\n' "$BACKEND_PORT"
  printf 'web_host=%s\n' "$WEB_HOST"
  printf 'web_port=%s\n' "$WEB_PORT"
  printf 'proxy_target=%s\n' "$PROXY_TARGET"
  printf 'skip_install=%s\n' "$SKIP_INSTALL"
  printf 'skip_build=%s\n' "$SKIP_BUILD"
  if [[ -d "$REPO_ROOT/node_modules" ]]; then
    printf 'root_node_modules=true\n'
  else
    printf 'root_node_modules=false\n'
  fi
  if root_dependencies_ready; then
    printf 'root_dependencies_ready=true\n'
  else
    printf 'root_dependencies_ready=false\n'
  fi
  if [[ -d "$REPO_ROOT/web/node_modules" ]]; then
    printf 'web_node_modules=true\n'
  else
    printf 'web_node_modules=false\n'
  fi
  if web_dependencies_ready; then
    printf 'web_dependencies_ready=true\n'
  else
    printf 'web_dependencies_ready=false\n'
  fi
  exit 0
fi

cleanup() {
  local exit_code="$1"

  trap - EXIT INT TERM

  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
  fi

  if [[ -n "${WEB_PID:-}" ]] && kill -0 "$WEB_PID" >/dev/null 2>&1; then
    kill "$WEB_PID" >/dev/null 2>&1 || true
  fi

  wait "${BACKEND_PID:-}" >/dev/null 2>&1 || true
  wait "${WEB_PID:-}" >/dev/null 2>&1 || true

  exit "$exit_code"
}

trap 'cleanup $?' EXIT
trap 'cleanup 130' INT TERM

cd "$REPO_ROOT"

if [[ "$SKIP_INSTALL" != "1" ]]; then
  if ! root_dependencies_ready; then
    printf '[setup] Installing root dependencies...\n'
    npm install
  fi

  if ! web_dependencies_ready; then
    printf '[setup] Installing web dependencies...\n'
    npm --prefix web install
  fi
fi

if [[ "$SKIP_BUILD" != "1" ]]; then
  printf '[setup] Building backend...\n'
  npm run build
fi

mkdir -p "$STATE_ROOT"

printf '[backend] http://%s:%s\n' "$BACKEND_HOST" "$BACKEND_PORT"
printf '[frontend] http://%s:%s\n' "$WEB_HOST" "$WEB_PORT"
printf '[state] %s\n' "$STATE_ROOT"
printf '[hint] Press Ctrl+C to stop both processes.\n'

node dist/src/cli.js serve \
  --state-root "$STATE_ROOT" \
  --host "$BACKEND_HOST" \
  --port "$BACKEND_PORT" &
BACKEND_PID=$!

AGENT_ENGINE_PROXY_TARGET="$PROXY_TARGET" \
  npm --prefix web run dev -- \
  --host "$WEB_HOST" \
  --port "$WEB_PORT" &
WEB_PID=$!

wait_for_process_exit() {
  while true; do
    if ! kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
      wait "$BACKEND_PID"
      return $?
    fi

    if ! kill -0 "$WEB_PID" >/dev/null 2>&1; then
      wait "$WEB_PID"
      return $?
    fi

    sleep 1
  done
}

wait_for_process_exit
