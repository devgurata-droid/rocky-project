---
description: Publish current work as a ROC-* Linear issue, branch, commit, PR, and Linear sync
---

Read the skill file at `.agents/skills/roc-publish/SKILL.md` and follow its workflow to publish the current repository work through the Rocky-project Linear and GitHub flow.

Also read these supporting skills as needed:
- `.agents/skills/linear/SKILL.md`
- `.agents/skills/github/SKILL.md`
- `.agents/skills/git-safe-operations/SKILL.md`

Execute the full publish sequence:
1. Scope the worktree (git status, diff)
2. Resolve or create the ROC-* Linear issue
3. Prepare, commit, and push the branch
4. Open or update the GitHub PR (draft by default)
5. Sync the PR link back to Linear

If the user provides arguments (e.g. an issue key like `ROC-6`), treat them as the target issue identifier.

Arguments: $ARGUMENTS
