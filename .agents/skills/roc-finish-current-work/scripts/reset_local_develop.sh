#!/usr/bin/env bash
set -euo pipefail

base_ref="${1:-origin/develop}"

if git show-ref --verify --quiet "refs/heads/develop"; then
  git switch develop
else
  git switch -c develop --track "${base_ref}"
fi

git reset --hard "${base_ref}"
