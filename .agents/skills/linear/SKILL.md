---
name: linear
description: Track repository work in Linear as the source of truth. Use when creating or updating `ROC-*` issues, syncing branch and validation notes, attaching PR URLs, or leaving concise progress comments for code work.
---

# Linear

## Goal

- Keep Linear as the execution tracker for repo work.
- Prefer Rocky-project issue keys such as `ROC-5` over generic placeholders.
- Keep issue updates small and tied to concrete code or PR state.

## Workflow

0. Ensure Linear access is active.
- If Linear tools are unavailable because the MCP is disabled, run `bash .agents/skills/mcp-on-demand/scripts/mcp-on-demand.sh enable linear`.
- Tell the user to restart Codex, then stop there for this turn.

1. Resolve the target first.
- Use a concrete issue identifier such as `ROC-5` when possible.
- If the user wants to publish current local changes and no issue exists yet, create one from the current diff summary before opening a PR.
- For projects, milestones, labels, or users, resolve the exact target by name, slug, or id before writing.
- If the target is ambiguous, list or fetch candidates first instead of guessing.

2. Read before write.
- For issue work, start with `get_issue` and `list_comments` when comment history matters.
- For project work, start with `get_project`; include milestones or resources only when needed.
- Use `list_issues`, `list_projects`, `list_milestones`, `list_issue_statuses`, and `list_users` to narrow the target when the user gives a partial name.

3. Sync code context.
- Capture the change summary, intended validation, and any known blockers in the issue description or comments.
- If the issue already exposes `gitBranchName`, prefer reusing it when the branch is created.
- Keep the issue title and branch summary aligned so `$git-safe-operations` and `$github` can reuse the same wording.

4. Update only the fields that matter.
- Use `save_issue` for title, description, links, labels, and state updates that are directly related to the requested workflow.
- Use `save_comment` for short progress notes that say what changed, how it was verified, and what remains.
- Add the PR URL or review URL to the issue once `$github` returns it.
- Use `create_document` or `update_document` only when the user explicitly wants long-form notes in Linear.
- Do not change assignee, priority, due date, or status unless the user asked for it or the workflow clearly requires it.

5. Follow the publish sequence.
- For code publication, prefer `$linear` -> `$git-safe-operations` -> `$github` -> `$linear`.
- The final Linear update should contain the exact PR URL and any validation summary worth preserving.

6. Report the outcome clearly.
- Return the exact Linear issue, project, milestone, or document identifiers that were read or changed.
- For write actions, mention the fields updated and whether a comment or document was created.

## Quick Tool Paths

- Issue read/update: `get_issue`, `list_comments`, `save_issue`, `save_comment`
- Project read/update: `get_project`, `list_projects`, `save_project`
- Milestones: `get_milestone`, `list_milestones`, `save_milestone`
- Documents: `create_document`, `get_document`, `update_document`
- Directory lookup: `list_users`, `list_issue_labels`, `list_issue_statuses`, `list_teams`
