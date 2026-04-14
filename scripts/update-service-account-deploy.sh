#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$SCRIPT_REPO_ROOT"

usage() {
  cat <<'EOF'
Usage:
  scripts/update-service-account-deploy.sh [options]

Options:
  --check                     Print the derived update/restart settings and exit.
  --repo-root <path>          Service checkout root. Defaults to the parent of this script.
  --service-user <user>       OS account that owns the checkout. Defaults to $AGENT_ENGINE_SERVICE_USER or the current user.
  --service-home <path>       Service HOME. Defaults to $AGENT_ENGINE_HOME or /home/<service-user>.
  --toolchain-bin <path>      Prepend a shared node/npm toolchain bin to PATH.
  --remote <name>             Git remote. Defaults to $AGENT_ENGINE_GIT_REMOTE or origin.
  --branch <name>             Git branch. Defaults to $AGENT_ENGINE_GIT_BRANCH or develop.
  --env-file <path>           Dotenv file to read GITLAB_ACCESS_TOKEN from before switching user.
  --git-ssl-no-verify         Run Git with http.sslVerify=false for self-signed internal GitLab.
  --git-ssl-ca-info <path>    Run Git with http.sslCAInfo=<path>.
  --systemd-service <name>    Restart this systemd unit after the update succeeds.
  --skip-install              Skip npm install.
  --skip-build                Skip npm run build.
  --skip-restart              Do not restart systemd even if a unit is configured.
  -h, --help                  Show this help.

Environment:
  AGENT_ENGINE_SERVICE_USER
  AGENT_ENGINE_HOME
  AGENT_ENGINE_TOOLCHAIN_BIN
  AGENT_ENGINE_GIT_REMOTE
  AGENT_ENGINE_GIT_BRANCH
  AGENT_ENGINE_GIT_ENV_FILE
  AGENT_ENGINE_GIT_SSL_NO_VERIFY
  AGENT_ENGINE_GIT_SSL_CAINFO
  AGENT_ENGINE_SYSTEMD_SERVICE
  GITLAB_ACCESS_TOKEN

Examples:
  sudo env \
    AGENT_ENGINE_SERVICE_USER=agent-engine \
    AGENT_ENGINE_HOME=/home/agent-engine \
    AGENT_ENGINE_TOOLCHAIN_BIN=/home/agent-engine/n/bin \
    AGENT_ENGINE_GIT_SSL_NO_VERIFY=1 \
    AGENT_ENGINE_SYSTEMD_SERVICE=agent-engine \
    /home/sfa/projects/rocky-project/scripts/update-service-account-deploy.sh \
    --repo-root /home/agent-engine/rocky-project \
    --check

  sudo env \
    AGENT_ENGINE_SERVICE_USER=agent-engine \
    AGENT_ENGINE_HOME=/home/agent-engine \
    AGENT_ENGINE_TOOLCHAIN_BIN=/home/agent-engine/n/bin \
    AGENT_ENGINE_GIT_SSL_NO_VERIFY=1 \
    AGENT_ENGINE_SYSTEMD_SERVICE=agent-engine \
    /home/sfa/projects/rocky-project/scripts/update-service-account-deploy.sh \
    --repo-root /home/agent-engine/rocky-project
EOF
}

fail() {
  printf 'update-service-account-deploy: %s\n' "$1" >&2
  exit 1
}

quote() {
  printf '%q' "$1"
}

current_user() {
  id -un
}

trim_matching_quotes() {
  local value="$1"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

load_gitlab_access_token() {
  local env_file="$1"
  if [[ -n "${GITLAB_ACCESS_TOKEN:-}" ]]; then
    return 0
  fi
  if [[ -z "$env_file" || ! -f "$env_file" ]]; then
    return 0
  fi

  local line
  line="$(grep -E '^GITLAB_ACCESS_TOKEN=' "$env_file" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 0
  fi

  GITLAB_ACCESS_TOKEN="$(trim_matching_quotes "${line#GITLAB_ACCESS_TOKEN=}")"
  export GITLAB_ACCESS_TOKEN
}

run_update() {
  local service_user="$1"
  local service_home="$2"
  local toolchain_bin="$3"
  local repo_root="$4"
  local remote="$5"
  local branch="$6"
  local gitlab_access_token="$7"
  local git_ssl_no_verify="$8"
  local git_ssl_ca_info="$9"
  local skip_install="${10}"
  local skip_build="${11}"
  local system_path="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  local inner_cmd

  inner_cmd=$(
    cat <<'EOF'
set -euo pipefail
git_update() {
  local -a git_args=(git)
  if [[ -n "${GITLAB_ACCESS_TOKEN:-}" ]]; then
    local auth_header
    auth_header="$(printf 'oauth2:%s' "$GITLAB_ACCESS_TOKEN" | base64 | tr -d '\n')"
    git_args+=(-c "http.extraHeader=Authorization: Basic ${auth_header}")
  fi
  if [[ "${AGENT_ENGINE_GIT_SSL_NO_VERIFY:-0}" == "1" ]]; then
    git_args+=(-c http.sslVerify=false)
  fi
  if [[ -n "${AGENT_ENGINE_GIT_SSL_CAINFO:-}" ]]; then
    git_args+=(-c "http.sslCAInfo=${AGENT_ENGINE_GIT_SSL_CAINFO}")
  fi
  "${git_args[@]}" "$@"
}

cd "__REPO_ROOT__"
if [[ -n "$(git_update status --short)" ]]; then
  echo "Checkout is dirty. Commit or clean local changes before updating." >&2
  exit 1
fi
git_update fetch "__REMOTE__" "__BRANCH__"
git_update switch "__BRANCH__"
git_update merge --ff-only "__REMOTE__/__BRANCH__"
EOF
  )
  inner_cmd="${inner_cmd//__REPO_ROOT__/$(quote "$repo_root")}"
  inner_cmd="${inner_cmd//__REMOTE__/$(quote "$remote")}"
  inner_cmd="${inner_cmd//__BRANCH__/$(quote "$branch")}"

  if [[ "$skip_install" == "0" ]]; then
    inner_cmd+=$'\n'"npm install"
  fi

  if [[ "$skip_build" == "0" ]]; then
    inner_cmd+=$'\n'"npm run build"
  fi

  if [[ "$(current_user)" == "$service_user" ]]; then
    if [[ -n "$toolchain_bin" ]]; then
      [[ -d "$toolchain_bin" ]] || fail "Toolchain bin directory does not exist: $toolchain_bin"
      export PATH="$toolchain_bin:$system_path"
    elif [[ -z "${PATH:-}" ]]; then
      export PATH="$system_path"
    fi
    export HOME="$service_home"
    if [[ -n "$gitlab_access_token" ]]; then
      export GITLAB_ACCESS_TOKEN="$gitlab_access_token"
    fi
    export AGENT_ENGINE_GIT_SSL_NO_VERIFY="$git_ssl_no_verify"
    export AGENT_ENGINE_GIT_SSL_CAINFO="$git_ssl_ca_info"
    bash -lc "$inner_cmd"
    return 0
  fi

  local env_args=(HOME="$service_home")
  if [[ -n "$toolchain_bin" ]]; then
    [[ -d "$toolchain_bin" ]] || fail "Toolchain bin directory does not exist: $toolchain_bin"
    env_args+=(PATH="$toolchain_bin:$system_path")
  else
    env_args+=(PATH="$system_path")
  fi
  if [[ -n "$gitlab_access_token" ]]; then
    env_args+=(GITLAB_ACCESS_TOKEN="$gitlab_access_token")
  fi
  env_args+=(AGENT_ENGINE_GIT_SSL_NO_VERIFY="$git_ssl_no_verify")
  if [[ -n "$git_ssl_ca_info" ]]; then
    env_args+=(AGENT_ENGINE_GIT_SSL_CAINFO="$git_ssl_ca_info")
  fi

  sudo -u "$service_user" -H env "${env_args[@]}" bash -lc "$inner_cmd"
}

CHECK_ONLY=0
SERVICE_USER="${AGENT_ENGINE_SERVICE_USER:-$(current_user)}"
SERVICE_HOME="${AGENT_ENGINE_HOME:-}"
TOOLCHAIN_BIN="${AGENT_ENGINE_TOOLCHAIN_BIN:-}"
REMOTE="${AGENT_ENGINE_GIT_REMOTE:-origin}"
BRANCH="${AGENT_ENGINE_GIT_BRANCH:-develop}"
ENV_FILE="${AGENT_ENGINE_GIT_ENV_FILE:-}"
GIT_SSL_NO_VERIFY="${AGENT_ENGINE_GIT_SSL_NO_VERIFY:-0}"
GIT_SSL_CAINFO="${AGENT_ENGINE_GIT_SSL_CAINFO:-}"
SYSTEMD_SERVICE="${AGENT_ENGINE_SYSTEMD_SERVICE:-}"
SKIP_INSTALL=0
SKIP_BUILD=0
SKIP_RESTART=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      CHECK_ONLY=1
      shift
      ;;
    --repo-root)
      [[ $# -ge 2 ]] || fail "--repo-root requires a value"
      REPO_ROOT="$2"
      shift 2
      ;;
    --service-user)
      [[ $# -ge 2 ]] || fail "--service-user requires a value"
      SERVICE_USER="$2"
      shift 2
      ;;
    --service-home)
      [[ $# -ge 2 ]] || fail "--service-home requires a value"
      SERVICE_HOME="$2"
      shift 2
      ;;
    --toolchain-bin)
      [[ $# -ge 2 ]] || fail "--toolchain-bin requires a value"
      TOOLCHAIN_BIN="$2"
      shift 2
      ;;
    --remote)
      [[ $# -ge 2 ]] || fail "--remote requires a value"
      REMOTE="$2"
      shift 2
      ;;
    --branch)
      [[ $# -ge 2 ]] || fail "--branch requires a value"
      BRANCH="$2"
      shift 2
      ;;
    --env-file)
      [[ $# -ge 2 ]] || fail "--env-file requires a value"
      ENV_FILE="$2"
      shift 2
      ;;
    --git-ssl-no-verify)
      GIT_SSL_NO_VERIFY=1
      shift
      ;;
    --git-ssl-ca-info)
      [[ $# -ge 2 ]] || fail "--git-ssl-ca-info requires a value"
      GIT_SSL_CAINFO="$2"
      shift 2
      ;;
    --systemd-service)
      [[ $# -ge 2 ]] || fail "--systemd-service requires a value"
      SYSTEMD_SERVICE="$2"
      shift 2
      ;;
    --skip-install)
      SKIP_INSTALL=1
      shift
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --skip-restart)
      SKIP_RESTART=1
      shift
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

[[ -n "$REPO_ROOT" ]] || fail "Repository root is required."
[[ -d "$REPO_ROOT" ]] || fail "Repository root does not exist: $REPO_ROOT"
[[ -d "$REPO_ROOT/.git" || -f "$REPO_ROOT/.git" ]] || fail "Repository root is not a Git checkout: $REPO_ROOT"

if [[ -z "$ENV_FILE" && -f "$SCRIPT_REPO_ROOT/.env" ]]; then
  ENV_FILE="$SCRIPT_REPO_ROOT/.env"
fi
load_gitlab_access_token "$ENV_FILE"

if [[ -z "$SERVICE_HOME" ]]; then
  SERVICE_HOME="/home/$SERVICE_USER"
fi

[[ -n "$SERVICE_USER" ]] || fail "Service user is required."
[[ -n "$SERVICE_HOME" ]] || fail "Service home is required."

if [[ "$CHECK_ONLY" == "1" ]]; then
  printf 'repo_root=%s\n' "$REPO_ROOT"
  printf 'service_user=%s\n' "$SERVICE_USER"
  printf 'service_home=%s\n' "$SERVICE_HOME"
  printf 'toolchain_bin=%s\n' "${TOOLCHAIN_BIN:-<none>}"
  printf 'remote=%s\n' "$REMOTE"
  printf 'branch=%s\n' "$BRANCH"
  printf 'env_file=%s\n' "${ENV_FILE:-<none>}"
  if [[ -n "${GITLAB_ACCESS_TOKEN:-}" ]]; then
    printf 'gitlab_access_token_loaded=true\n'
  else
    printf 'gitlab_access_token_loaded=false\n'
  fi
  printf 'git_ssl_no_verify=%s\n' "$GIT_SSL_NO_VERIFY"
  printf 'git_ssl_ca_info=%s\n' "${GIT_SSL_CAINFO:-<none>}"
  printf 'systemd_service=%s\n' "${SYSTEMD_SERVICE:-<none>}"
  printf 'skip_install=%s\n' "$SKIP_INSTALL"
  printf 'skip_build=%s\n' "$SKIP_BUILD"
  printf 'skip_restart=%s\n' "$SKIP_RESTART"
  exit 0
fi

run_update \
  "$SERVICE_USER" \
  "$SERVICE_HOME" \
  "$TOOLCHAIN_BIN" \
  "$REPO_ROOT" \
  "$REMOTE" \
  "$BRANCH" \
  "${GITLAB_ACCESS_TOKEN:-}" \
  "$GIT_SSL_NO_VERIFY" \
  "$GIT_SSL_CAINFO" \
  "$SKIP_INSTALL" \
  "$SKIP_BUILD"

if [[ -n "$SYSTEMD_SERVICE" && "$SKIP_RESTART" == "0" ]]; then
  if [[ "$EUID" -ne 0 ]]; then
    fail "Restarting systemd requires root. Re-run with sudo or pass --skip-restart."
  fi
  systemctl restart "$SYSTEMD_SERVICE"
  systemctl is-active --quiet "$SYSTEMD_SERVICE" || fail "systemd unit is not active after restart: $SYSTEMD_SERVICE"
  printf 'restarted_systemd_service=%s\n' "$SYSTEMD_SERVICE"
fi
