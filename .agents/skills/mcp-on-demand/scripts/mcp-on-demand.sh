#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"

GLOBAL_CONFIG="${HOME}/.codex/config.toml"
GLOBAL_BACKUP="${HOME}/.codex/config.toml.mcp-on-demand.bak"
PROJECT_CONFIG="${REPO_ROOT}/.codex/config.toml"
PROJECT_MCP_JSON="${REPO_ROOT}/.mcp.json"

NOTION_ENABLED_CONTENT='[mcp_servers.notion]
url = "https://mcp.notion.com/mcp"

[mcp_servers.notion.tools.notion-update-page]
approval_mode = "approve"'

NOTION_DISABLED_CONTENT='# Managed by mcp-on-demand skill.
# Run `bash .agents/skills/mcp-on-demand/scripts/mcp-on-demand.sh enable notion`
# and restart Codex to enable project Notion MCP for this repo.'

NOTION_MCP_ENABLED_JSON='{
  "mcpServers": {
    "notion": {
      "type": "http",
      "url": "https://mcp.notion.com/mcp"
    }
  }
}'

NOTION_MCP_DISABLED_JSON='{
  "mcpServers": {}
}'

GITHUB_TRUE='[plugins."github@openai-curated"]
enabled = true'

GITHUB_FALSE='[plugins."github@openai-curated"]
enabled = false'

GOOGLE_DRIVE_TRUE='[plugins."google-drive@openai-curated"]
enabled = true'

GOOGLE_DRIVE_FALSE='[plugins."google-drive@openai-curated"]
enabled = false'

LINEAR_BLOCK='[mcp_servers.linear]
url = "https://mcp.linear.app/mcp"'

usage() {
  cat <<'EOF'
Usage:
  bash .agents/skills/mcp-on-demand/scripts/mcp-on-demand.sh status
  bash .agents/skills/mcp-on-demand/scripts/mcp-on-demand.sh disable-all
  bash .agents/skills/mcp-on-demand/scripts/mcp-on-demand.sh enable <provider> [provider...]

Providers:
  notion
  linear
  github
  google-drive

Notes:
  - enable disables all managed providers first, then enables only the named set
  - restart Codex after any enable or disable-all change
EOF
}

ensure_parent_dir() {
  mkdir -p "$(dirname "$1")"
}

ensure_file() {
  ensure_parent_dir "$1"
  if [ ! -f "$1" ]; then
    : > "$1"
  fi
}

backup_global_config() {
  if [ -f "$GLOBAL_CONFIG" ] && [ ! -f "$GLOBAL_BACKUP" ]; then
    cp "$GLOBAL_CONFIG" "$GLOBAL_BACKUP"
  fi
}

replace_or_append_exact() {
  local file="$1"
  local from_block="$2"
  local to_block="$3"

  ensure_file "$file"
  FROM_BLOCK="$from_block" TO_BLOCK="$to_block" perl -0pi -e '
    my $from = $ENV{FROM_BLOCK};
    my $to = $ENV{TO_BLOCK};
    if (index($_, $from) >= 0) {
      s/\Q$from\E/$to/s;
    } elsif (index($_, $to) < 0) {
      $_ .= "\n" unless $_ eq q{} || /\n\z/;
      $_ .= $to . "\n";
    }
  ' "$file"
}

ensure_exact_block() {
  local file="$1"
  local block="$2"

  ensure_file "$file"
  BLOCK="$block" perl -0pi -e '
    my $block = $ENV{BLOCK};
    if (index($_, $block) < 0) {
      $_ .= "\n" unless $_ eq q{} || /\n\z/;
      $_ .= $block . "\n";
    }
  ' "$file"
}

remove_exact_block() {
  local file="$1"
  local block="$2"

  ensure_file "$file"
  BLOCK="$block" perl -0pi -e '
    my $block = $ENV{BLOCK};
    s/\n?\Q$block\E\n?/\n/s;
  ' "$file"
}

set_plugin() {
  local provider="$1"
  local enabled="$2"

  case "$provider" in
    github)
      if [ "$enabled" = "true" ]; then
        replace_or_append_exact "$GLOBAL_CONFIG" "$GITHUB_FALSE" "$GITHUB_TRUE"
      else
        replace_or_append_exact "$GLOBAL_CONFIG" "$GITHUB_TRUE" "$GITHUB_FALSE"
      fi
      ;;
    google-drive)
      if [ "$enabled" = "true" ]; then
        replace_or_append_exact "$GLOBAL_CONFIG" "$GOOGLE_DRIVE_FALSE" "$GOOGLE_DRIVE_TRUE"
      else
        replace_or_append_exact "$GLOBAL_CONFIG" "$GOOGLE_DRIVE_TRUE" "$GOOGLE_DRIVE_FALSE"
      fi
      ;;
    *)
      echo "Unknown plugin provider: $provider" >&2
      exit 1
      ;;
  esac
}

set_linear() {
  local enabled="$1"

  if [ "$enabled" = "true" ]; then
    ensure_exact_block "$GLOBAL_CONFIG" "$LINEAR_BLOCK"
  else
    remove_exact_block "$GLOBAL_CONFIG" "$LINEAR_BLOCK"
  fi
}

set_notion() {
  local enabled="$1"

  ensure_parent_dir "$PROJECT_CONFIG"
  if [ "$enabled" = "true" ]; then
    printf '%s\n' "$NOTION_ENABLED_CONTENT" > "$PROJECT_CONFIG"
    printf '%s\n' "$NOTION_MCP_ENABLED_JSON" > "$PROJECT_MCP_JSON"
  else
    printf '%s\n' "$NOTION_DISABLED_CONTENT" > "$PROJECT_CONFIG"
    printf '%s\n' "$NOTION_MCP_DISABLED_JSON" > "$PROJECT_MCP_JSON"
  fi
}

disable_all() {
  backup_global_config
  set_plugin github false
  set_plugin google-drive false
  set_linear false
  set_notion false
}

validate_provider() {
  case "$1" in
    notion|linear|github|google-drive) ;;
    *)
      echo "Unknown provider: $1" >&2
      usage
      exit 1
      ;;
  esac
}

enable_only() {
  if [ "$#" -eq 0 ]; then
    echo "enable requires at least one provider" >&2
    usage
    exit 1
  fi

  disable_all
  for provider in "$@"; do
    validate_provider "$provider"
    case "$provider" in
      notion)
        set_notion true
        ;;
      linear)
        set_linear true
        ;;
      github)
        set_plugin github true
        ;;
      google-drive)
        set_plugin google-drive true
        ;;
    esac
  done
}

status_line() {
  local label="$1"
  local value="$2"
  printf '%-13s %s\n' "$label" "$value"
}

current_status() {
  local notion_status="off"
  local linear_status="off"
  local github_status="off"
  local google_drive_status="off"

  if [ -f "$PROJECT_CONFIG" ] && grep -Fq '[mcp_servers.notion]' "$PROJECT_CONFIG"; then
    notion_status="on"
  fi

  if [ -f "$GLOBAL_CONFIG" ] && grep -Fq '[mcp_servers.linear]' "$GLOBAL_CONFIG"; then
    linear_status="on"
  fi

  if [ -f "$GLOBAL_CONFIG" ] && grep -Fq '[plugins."github@openai-curated"]' "$GLOBAL_CONFIG" && grep -Fq 'enabled = true' "$GLOBAL_CONFIG"; then
    github_status="$(awk '
      $0 == "[plugins.\"github@openai-curated\"]" { in_block = 1; next }
      in_block && $0 ~ /^\[/ { in_block = 0 }
      in_block && $0 == "enabled = true" { print "on"; found = 1; exit }
      END { if (!found) print "off" }
    ' "$GLOBAL_CONFIG")"
  fi

  if [ -f "$GLOBAL_CONFIG" ] && grep -Fq '[plugins."google-drive@openai-curated"]' "$GLOBAL_CONFIG"; then
    google_drive_status="$(awk '
      $0 == "[plugins.\"google-drive@openai-curated\"]" { in_block = 1; next }
      in_block && $0 ~ /^\[/ { in_block = 0 }
      in_block && $0 == "enabled = true" { print "on"; found = 1; exit }
      END { if (!found) print "off" }
    ' "$GLOBAL_CONFIG")"
  fi

  status_line notion "$notion_status"
  status_line linear "$linear_status"
  status_line github "$github_status"
  status_line google-drive "$google_drive_status"
}

main() {
  if [ ! -f "$GLOBAL_CONFIG" ]; then
    echo "Missing global Codex config: $GLOBAL_CONFIG" >&2
    exit 1
  fi

  local command="${1:-status}"
  shift || true

  case "$command" in
    status)
      current_status
      ;;
    disable-all)
      disable_all
      current_status
      echo
      echo "Restart Codex to apply the disabled state."
      ;;
    enable)
      enable_only "$@"
      current_status
      echo
      echo "Restart Codex to load the enabled provider set."
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
