#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <issue-branch>" >&2
  exit 1
fi

issue_branch="$1"

if git show-ref --verify --quiet "refs/heads/${issue_branch}"; then
  git switch "${issue_branch}"
else
  git switch -c "${issue_branch}"
fi
