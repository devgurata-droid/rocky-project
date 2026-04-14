---
name: github
description: Coordinate GitHub pull request work for this repository. Use when opening or updating PRs, aligning PR titles and bodies with `ROC-*` issues, checking review comments, or summarizing PR state after a push.
---

# GitHub

## Goal

- Turn pushed repository work into a GitHub pull request.
- Keep the PR aligned with the matching `ROC-*` Linear issue.
- Prefer connector-based GitHub operations and use local git only for branch context.

## Workflow

0. Ensure GitHub access is active.
- If GitHub connector tools are unavailable because the plugin is disabled, run `bash .agents/skills/mcp-on-demand/scripts/mcp-on-demand.sh enable github`.
- Tell the user to restart Codex, then stop there for this turn.

1. Confirm publish inputs.
- Resolve the repository, current branch, base branch, and matching Linear issue or agreed summary.
- In this repository, default the PR base branch to `develop` unless the user explicitly asked for another base.
- If the branch is not pushed yet, hand off to `$git-safe-operations` first.

2. Build PR metadata.
- Prefer PR titles like `[ROC-5] concise summary` when a Linear issue exists.
- Write a body that covers what changed, why, validation, and the Linear issue URL.
- Keep the PR as draft by default unless the user explicitly wants it ready for review or the change is a tiny follow-up the user asked to merge immediately.

3. Open or update the PR.
- Prefer GitHub connector tools for repository lookup, PR search, PR creation, comments, and metadata reads.
- Search for an existing PR for the current branch before creating a new one.
- If connector access is blocked and `gh` is installed and authenticated, use CLI fallback.
- If connector access is blocked and `gh` is unavailable, fall back to GitHub REST calls with `.env` `GITHUB_PAT`.
- If a draft PR must be marked ready and REST is unavailable, use the GitHub GraphQL `markPullRequestReadyForReview` mutation with the PR node id.

4. Sync back to Linear.
- Return the exact PR number and URL so `$linear` can attach them to the matching issue.
- If checks or reviews are blocking merge, summarize those blockers clearly for the follow-up issue update.

5. Handle review and status requests.
- For review feedback, inspect unresolved comments first.
- For CI questions, inspect the current PR status and failing checks before proposing changes.
- Keep summaries focused on merge blockers, requested actions, and current draft or review state.

6. Report the outcome.
- Return the repository, branch, PR number, URL, draft or ready state, and any known blockers.
- If the user asked to merge, confirm mergeability first and report the merge commit SHA after completion.

## Quick Tool Paths

- PR lookup: `search_prs`, `get_pr_info`, `list_pr_changed_filenames`
- PR creation/update: `create_pull_request`, `add_comment_to_issue`, `add_review_to_pr`
- Diff and review context: `fetch_pr_patch`, `fetch_pr_comments`, `get_pr_diff`
- Repo lookup: `search_repositories`, `list_repositories`, `get_profile`
