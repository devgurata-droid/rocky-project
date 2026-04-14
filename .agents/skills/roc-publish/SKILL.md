---
name: roc-publish
description: Publish current repository work through the Rocky-project Linear and GitHub flow. Use when creating or updating a `ROC-*` issue from local changes, pushing a scoped branch, opening or updating the matching PR, syncing the PR link back to Linear, or marking the issue `Done` after merge when automation is not confirmed.
---

# ROC Publish

## Goal

- Turn the current local change set into a Rocky-project `ROC-*` issue and matching GitHub PR.
- Keep the publication flow explicit: scope -> issue -> fresh branch from the integration base -> commit/push -> PR -> Linear sync.
- Do not publish directly from an arbitrary current branch unless the user explicitly wants to keep that branch.
- Do not assume Linear auto-completes the issue on PR merge unless that automation is visibly working.

## When To Use

- The user wants to register current changes as a Linear issue and create a PR.
- The user explicitly wants to continue an existing `ROC-*` branch or PR and sync it back to Linear.
- The user wants to finish the cycle after merge and close the matching Linear issue.

## Workflow

0. Ensure MCP access is active.
- If Linear or GitHub access is unavailable because the provider is disabled, run `bash .agents/skills/mcp-on-demand/scripts/mcp-on-demand.sh enable linear github`.
- Tell the user to restart Codex, then stop there for this turn.

1. Scope the worktree first.
- Start with `$git-safe-operations` style inspection: `git status --short --branch`, `git diff --stat`, and targeted diffs.
- If the current branch already contains multiple local commits, identify the exact commit range or file set that belongs in the new publication scope.
- Split unrelated files out of scope before creating the issue.
- In this repository, local files such as `.codex/` should usually stay out of the PR unless the user explicitly wants repo-local Codex config tracked.

2. Resolve the integration base before branching.
- In this repository, treat `develop` as the default integration base branch for ongoing product work.
- Do not infer the PR base from the current local topic branch.
- Refresh the base first with `git fetch origin develop` and prepare to branch from `origin/develop`.

3. Resolve or create the `ROC-*` issue.
- If the user already named an issue such as `ROC-6`, read it first with `$linear`.
- If no issue exists, create one from the actual diff summary.
- Capture included files, intentionally excluded files, validation status, and known blockers in the issue description or a short comment.
- Prefer the issue's suggested `gitBranchName` when it is reasonable; shorten it if needed for local branch safety while keeping the same `ROC-*` key.

4. Prepare and push a fresh branch.
- Use `$git-safe-operations` to create a fresh issue branch from the integration base, not from the current working branch.
- If the scoped work already lives on another local branch, transplant only the related commits or restage the scoped diff onto the fresh `ROC-*` branch.
- Reuse the current branch only when the user explicitly asked to publish that exact branch or when it is already the intended `ROC-*` branch.
- Stage only the intended files.
- Commit with a terse message that matches the diff; include the `ROC-*` key when it improves traceability.
- Push with the repository helper if `.env` `GITHUB_PAT` is the available auth path.

5. Open or update the PR.
- Use `$github` after the branch is on the remote.
- Prefer draft PRs by default for multi-commit or review-oriented work. For tiny follow-up fixes the user wants merged immediately, a ready PR is acceptable.
- Use `develop` as the default PR base branch for this repository unless the user explicitly asked for another base.
- Align the PR title with the issue, for example `[ROC-6] concise summary`.
- Include four body sections: summary, why, validation, and Linear issue link.
- Search for an existing PR for the branch before creating a new one.
- If the GitHub connector is unavailable and `gh` is not installed, fall back to GitHub REST or GraphQL calls using `.env` `GITHUB_PAT`.

6. Sync Linear after PR creation.
- Add the PR URL to the issue links.
- Leave a short comment with branch name, commit, PR URL, and validation result.
- If the team workflow uses `Backlog`, `Todo`, `In Progress`, `In Review`, and `Done`, move the issue only when the user asked for a status change or the workflow clearly calls for it.

7. Close the loop after merge.
- Do not assume merge will automatically move the issue to `Done`.
- Check whether the issue status actually changed after merge.
- If it did not, update the issue to `Done` with `$linear` and leave a brief completion note with the merged PR URL or commit.

## Default Sequence

- `$linear` to resolve or create the issue
- `$git-safe-operations` to branch from `develop`, transplant or restage the scoped work, commit, and push
- `$github` to open or update the PR
- `$linear` to attach the PR and, after merge, close the issue if needed

## Repository Notes

- Current Rocky-project team statuses are `Backlog`, `Todo`, `In Progress`, `In Review`, `Done`, `Canceled`, and `Duplicate`.
- In this workspace, Linear status automation should be treated as optional until observed on a real linked PR. A linked PR alone is not proof that merge will auto-complete the issue.
- The repository's GitHub default branch may still be `main`, but active integration work currently lands on `develop`. Prefer actual team flow over default-branch assumptions.
