---
name: git-safe-operations
description: Prepare local git state for publication in this repository. Use when inspecting the worktree, creating or switching branches, staging intended files, committing, or pushing without handling Linear issue updates or GitHub PR metadata directly.
---

# Git Safe Operations

## Goal

- Keep local git work narrow, explicit, and reversible.
- Own only branch, staging, commit, and push operations.
- Hand off issue tracking to `$linear` and pull request work to `$github`.

## Workflow

1. Inspect first.
- Start with `git status --short --branch`.
- Use `git diff --stat` and `git diff --cached --stat` before staging or committing.
- Read targeted diffs when the scope is not obvious.
- If the worktree is mixed, isolate the exact paths that belong in scope.
- Remove or ignore transient leftovers such as `.DS_Store`, scratch brainstorm docs, and accidental index entries before switching branches or publishing.

2. Branch deliberately.
- In this repository, treat `develop` as the integration base branch for publication work.
- When preparing a publish branch, start from updated `origin/develop` rather than from the current local topic branch unless the user explicitly asked to keep the current branch.
- If work starts from the integration branch, prefer an issue-based branch name when one exists.
- In this repository, prefer the Linear-provided branch name such as `devgurata/roc-5-short-topic` when the issue already exists.
- If scoped work already exists on another branch, move only the intended commits or restage the scoped diff onto the fresh issue branch.
- Do not rename, recreate, or reset a user branch unless explicitly asked.

3. Stage and commit safely.
- Stage only the intended files.
- Exclude transient files such as `__pycache__/`, `*.pyc`, editor leftovers, and unrelated local config.
- If the user says only "commit", choose a concise message that matches the actual diff.
- Include the issue key in the commit message only when it clarifies traceability.
- If `git commit` fails because `user.name` or `user.email` is missing, reuse the most recent local author from `git log -5 --format='%an <%ae>'` and set it with repository-local `git config`.
- Do not amend, rebase, or force-push unless explicitly requested.

4. Push safely.
- If the remote is already authenticated in the local environment, use a normal `git push`.
- If the repository uses the optional GitHub token helper, use `scripts/push-github-current-branch.sh`.
- If a plain `git fetch` fails for permission reasons but `.env` `GITHUB_PAT` exists, it is acceptable to run authenticated `git fetch origin develop` with the same token-header pattern used for push.
- If sandboxed network access blocks the push, rerun the same command with escalation rather than changing remotes or credentials.

5. Hand off after push.
- After the branch is pushed, use `$github` for PR creation or PR state inspection.
- If the branch maps to a Linear issue, use `$linear` to attach the PR URL and leave a short progress note.

6. Report the outcome.
- For commits, report the short hash and commit message.
- For pushes, report the branch name and remote.
- Mention if the worktree is still dirty after the operation.

## Quick Commands

```bash
git status --short --branch
git diff --stat
git diff --cached --stat
git branch --show-current
git log -5 --format='%an <%ae>'
git fetch origin develop
git switch develop
git merge --ff-only origin/develop
bash scripts/push-github-current-branch.sh
```

## Resources

- `scripts/push-github-current-branch.sh`: Push the current branch to `origin` using `.env` `GITHUB_PAT`.
