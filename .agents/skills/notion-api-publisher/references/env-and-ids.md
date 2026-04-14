# Environment And IDs

## Required Variables

- `NOTION_API_TOKEN`
  - Internal integration token used for direct Notion API calls.
  - Keep it outside git-tracked files.
- `NOTION_DOCUMENT_HUB_DATA_SOURCE_ID`
  - Preferred. The script can create pages directly under this data source.
- `NOTION_DOCUMENT_HUB_DATABASE_ID`
  - Fallback. The script will retrieve the database, pick its first data source, and create the page there.

## Optional Variable

- `NOTION_API_VERSION`
  - Default: `2025-09-03`
  - Override only if the workspace integration is pinned to a different Notion API version.

## ID Notes

- The script accepts raw IDs or full Notion URLs.
- When a Notion URL includes both a page/database ID and view query params, the script ignores the query string and extracts the canonical ID from the path.
- For `문서 허브`, prefer the data source ID if you know it. It avoids an extra API call and removes ambiguity if the database ever gains multiple data sources.

## Typical Shell Setup

```bash
export NOTION_API_TOKEN="secret_xxx"
export NOTION_DOCUMENT_HUB_DATA_SOURCE_ID="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

If only the database ID is available:

```bash
export NOTION_API_TOKEN="secret_xxx"
export NOTION_DOCUMENT_HUB_DATABASE_ID="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

## Current Scope

- This skill is optimized for `문서 허브` publishing.
- It can append to any page URL or page ID.
- It does not try to manage Notion database schemas beyond resolving the title property.
