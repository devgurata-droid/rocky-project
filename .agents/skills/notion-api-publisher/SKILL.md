---
name: notion-api-publisher
description: Publish or append structured Markdown notes to the 픽셀베리 Notion 문서 허브 by calling the Notion API directly with an integration token instead of MCP. Use when a brainstorm, decision, summary, or implementation note should be saved to Notion without loading Notion MCP context.
---

# Notion API Publisher

## Goal

- Save structured notes to Notion without enabling MCP.
- Default to the 픽셀베리 `문서 허브` data source.
- Keep the flow small: draft Markdown locally, then create or append a Notion page with one script.

## Required Environment

- `NOTION_API_TOKEN`
- One of:
  - `NOTION_DOCUMENT_HUB_DATA_SOURCE_ID`
  - `NOTION_DOCUMENT_HUB_DATABASE_ID`
- Optional:
  - `NOTION_API_VERSION`

Read [references/env-and-ids.md](references/env-and-ids.md) when IDs or environment setup are unclear.

## Workflow

1. Decide whether to create or append.
- If the user gave an existing Notion page link, append to that page.
- Otherwise create a new page in `문서 허브`.

2. Draft concise Markdown first.
- Use a small, readable structure such as `## 배경`, `## 핵심 내용`, `## 결정`, `## 다음 액션`.
- Prefer shallow lists and short paragraphs.

3. Publish through the local script.
- Create:
  - `node .agents/skills/notion-api-publisher/scripts/notion-api-publish.mjs create --title "..." --content-file /tmp/note.md`
- Append:
  - `node .agents/skills/notion-api-publisher/scripts/notion-api-publish.mjs append --page "https://www.notion.so/..." --content-file /tmp/update.md`
- Validate block conversion without calling the API:
  - `node .agents/skills/notion-api-publisher/scripts/notion-api-publish.mjs append --page deadbeefdeadbeefdeadbeefdeadbeef --content "# Test" --dry-run`

4. Report the outcome.
- Return whether the page was created or appended.
- Return the Notion page URL.
- Mention any skipped metadata or schema mismatch if the target data source rejected the write.

## Markdown Support

The script intentionally supports a narrow subset:

- `#`, `##`, `###` headings
- Paragraphs
- `-` bulleted lists
- `1.` numbered lists
- `- [ ]` and `- [x]` todos
- `>` quotes
- Fenced code blocks
- `---` dividers
- `![caption](https://...)` external image blocks
- Inline `**bold**`, `*italic*`, ``code``, and `[links](https://...)`

## Constraints

- Do not use Notion MCP tools in this workflow.
- The script only auto-fills the title property for new pages.
- If the destination data source requires extra properties, update the script before retrying instead of guessing property names during the run.
- Notion cannot embed local file paths. Use public URLs for images.
