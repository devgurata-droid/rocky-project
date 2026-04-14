---
name: bug-report
description: >
  Document observed UI or API bugs in this repository by capturing Playwright screenshots,
  uploading them to a public image host, and creating scoped Notion work tracker entries
  with embedded images. Use when a user describes a visual or functional defect and wants
  it tracked in the 픽셀베리 Notion workspace.
---

# Bug Report

## Goal

- Turn a user-described bug into a reproducible Notion work tracker entry with embedded evidence.
- Capture screenshots or video with Playwright against the running local dev server.
- Upload images to a public host so Notion can embed them inline (not as local paths).
- Create one `작업 트래커` entry per distinct bug with title, description, root cause, fix direction, and screenshot.

## When To Use

- The user describes a UI defect or unexpected API behavior and asks to document it.
- The user wants a Notion bug tracker entry created from observed symptoms.
- Multiple bugs are reported at once — create one entry per bug.

## Workflow

### 0. Ensure Notion access is active

If Notion MCP is unavailable because it is disabled, run `bash .agents/skills/mcp-on-demand/scripts/mcp-on-demand.sh enable notion`.

Tell the user to restart Codex, then stop there for this turn.

### 1. Start the dev server if not running

Check whether the web dev server is already up before starting a new one.

```bash
curl -s http://127.0.0.1:4175 -o /dev/null -w "%{http_code}"
# If 000, start it:
cd web && npm run dev > /tmp/web-dev.log 2>&1 &
sleep 5 && cat /tmp/web-dev.log | grep "Local:"   # find the actual port
```

The dev server often lands on a non-default port (4175, 4176, …) if 5173 is taken. Always read the log to confirm the port.

### 2. Find real session/agent IDs for Playwright

Use the live API instead of fake IDs so the session workspace page renders correctly.

```bash
curl -s http://127.0.0.1:<PORT>/api/agents
curl -s http://127.0.0.1:<PORT>/api/agents/<agentId>/sessions
```

Pick the most relevant session (e.g. one that already has messages, for transcript bugs).

### 3. Install Playwright in a temp runner if not in project deps

```bash
npm install --prefix /tmp/pw-runner playwright
npx playwright install chromium --with-deps
```

### 4. Write and run the Playwright capture script

- Run headless Chromium at 1440×900.
- Navigate to the real session URL: `/agents/:agentId/sessions/:sessionId`.
- Capture full-page and clipped screenshots for each bug.
- Intercept network responses (`page.on('response', ...)`) to catch HTTP errors live.
- Save screenshots to `/tmp/bug-screenshots/`.

For the send-button visibility bug: clip to the composer area bounding box.
For color/contrast bugs: read computed CSS vars with `page.evaluate(() => getComputedStyle(...))`.
For 500-error bugs: use `page.waitForResponse(res => res.status() >= 400)` then screenshot.

### 5. Upload screenshots to a public image host

Local file paths cannot be embedded in Notion. Upload to **catbox.moe** (permanent, no auth):

```bash
URL=$(curl -s -F "reqtype=fileupload" -F "fileToUpload=@/tmp/bug-screenshots/bug.png" \
  https://catbox.moe/user/api.php)
echo $URL   # https://files.catbox.moe/xxxxxx.png
```

Upload each screenshot separately and record all returned URLs before creating Notion entries.

**Fallback hosts** (in order of preference if catbox.moe is down):
- `transfer.sh`: `curl --upload-file image.png https://transfer.sh/image.png`
- GitHub release assets on this repo (requires PAT from `.env`)

Do **not** use:
- Raw GitHub URLs from private repositories (require auth — Notion cannot render them).
- `0x0.st` (currently disabled).
- Base64 data URLs (not supported by Notion image blocks).

### 6. Create Notion work tracker entries

Database: `작업 트래커` — data source ID `3352cb82-8b9d-801e-b68b-000b1ca70811`

Schema defaults for bugs:
- `상태`: `진행 중`
- `우선순위`: `높음` for visible/blocking bugs, `보통` for cosmetic issues
- `작업 유형`: `["🐞 버그"]` — add `["💅 다듬기"]` for purely cosmetic defects
- `노력 수준`: `작게` for CSS/styling fixes, `보통` for logic/API fixes

Page content structure (Notion markdown):

```
## 현상
[one-sentence description of what the user sees]

## 재현 경로
1. …

## 스크린샷
![caption](https://files.catbox.moe/xxxxxx.png)

## 원인 분석
[code location, relevant snippet, CSS variable values, etc.]

## 수정 방향
- [concrete fix suggestion]
```

Use `mcp__notion__notion-create-pages` with `parent.data_source_id` for all bugs in a single call when possible.

### 7. Report outcome

Return:
- Notion page URLs for each bug entry
- Screenshot URLs (catbox.moe)
- A one-line root cause summary per bug

## Repository Notes

- Web dev server root: `web/` — run with `npm run dev` inside that directory.
- Playwright is not in project `package.json`; install to `/tmp/pw-runner/` to avoid polluting deps.
- The agent-engine backend must be running for 500-error bugs to reproduce. Check `scripts/run-dev-stack.sh`.
- `작업 트래커` Notion database URL: `https://www.notion.so/3352cb828b9d802eb202f91689bcd242`
