---
description: Capture Playwright screenshots for bugs and create Notion 작업 트래커 entries with embedded images
---

Read the skill file at `.agents/skills/bug-report/SKILL.md` and follow its workflow to document the described bugs.

Execute the full bug-report sequence:
1. Start the web dev server if not running (check port, read log for actual port)
2. Find real agent/session IDs from the live API
3. Run Playwright (install to /tmp/pw-runner if needed) to capture screenshots
4. Upload each screenshot to catbox.moe for a public URL
5. Create one 작업 트래커 entry per bug in Notion with the image embedded inline
6. Return Notion page URLs and a root-cause summary per bug

If the user provides specific bug descriptions or symptoms, use those as the basis for each entry title and 현상 section.

Arguments: $ARGUMENTS
