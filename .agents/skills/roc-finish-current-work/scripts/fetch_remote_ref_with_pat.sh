#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
REMOTE="${1:-origin}"
REFSPEC="${2:-develop}"

fail() {
  printf 'fetch_remote_ref_with_pat: %s\n' "$1" >&2
  exit 1
}

load_env_value() {
  local key="$1"
  local value

  value="$(sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1)"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"

  printf '%s' "$value"
}

cd "$REPO_ROOT"

[[ -f "$ENV_FILE" ]] || fail ".env file not found at $ENV_FILE"

GITHUB_PAT="$(load_env_value "GITHUB_PAT")"
[[ -n "$GITHUB_PAT" ]] || fail "GITHUB_PAT is missing from $ENV_FILE"

REMOTE_URL="$(git remote get-url "$REMOTE" 2>/dev/null)" || fail "Remote '$REMOTE' is not configured."
AUTH_HEADER="$(printf 'x-access-token:%s' "$GITHUB_PAT" | base64 | tr -d '\n')"

git -c credential.helper= \
  -c "http.${REMOTE_URL}.extraheader=AUTHORIZATION: basic ${AUTH_HEADER}" \
  fetch "$REMOTE" "$REFSPEC"
