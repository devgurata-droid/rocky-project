#!/usr/bin/env node

import fs from "node:fs/promises";
import process from "node:process";

const NOTION_BASE_URL = "https://api.notion.com/v1";
const DEFAULT_NOTION_VERSION = process.env.NOTION_API_VERSION ?? "2025-09-03";
const DEFAULT_TEXT_ANNOTATIONS = Object.freeze({
  bold: false,
  italic: false,
  strikethrough: false,
  underline: false,
  code: false,
  color: "default",
});
const CODE_LANGUAGE_ALIASES = new Map([
  ["bash", "bash"],
  ["c", "c"],
  ["c#", "c#"],
  ["cpp", "c++"],
  ["c++", "c++"],
  ["css", "css"],
  ["diff", "diff"],
  ["go", "go"],
  ["graphql", "graphql"],
  ["html", "html"],
  ["java", "java"],
  ["javascript", "javascript"],
  ["js", "javascript"],
  ["json", "json"],
  ["jsx", "javascript"],
  ["markdown", "markdown"],
  ["md", "markdown"],
  ["plain", "plain text"],
  ["plaintext", "plain text"],
  ["py", "python"],
  ["python", "python"],
  ["rb", "ruby"],
  ["ruby", "ruby"],
  ["rs", "rust"],
  ["rust", "rust"],
  ["sh", "bash"],
  ["shell", "bash"],
  ["sql", "sql"],
  ["text", "plain text"],
  ["ts", "typescript"],
  ["tsx", "typescript"],
  ["typescript", "typescript"],
  ["xml", "xml"],
  ["yaml", "yaml"],
  ["yml", "yaml"],
  ["zsh", "bash"],
]);

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));

  if (command === "help") {
    printUsage();
    return;
  }

  if (!["create", "append"].includes(command)) {
    throw new Error(`Unsupported command: ${command}`);
  }

  const content = await loadContent(options);
  const blocks = markdownToBlocks(content);

  if (command === "create") {
    const title = requireNonEmpty(options.title, "--title is required for create");
    const createPlan = await resolveCreatePlan(options);

    if (options.dryRun) {
      printJson({
        action: "create",
        dryRun: true,
        title,
        target: createPlan,
        blockCount: blocks.length,
        blocks,
      });
      return;
    }

    const token = getNotionToken();
    const page = await createPage({
      token,
      title,
      icon: options.icon,
      blocks,
      dataSourceId: createPlan.dataSourceId,
      titlePropertyName: createPlan.titlePropertyName,
    });

    printJson({
      action: "create",
      dryRun: false,
      pageId: page.id,
      pageUrl: page.url,
      blockCount: blocks.length,
      dataSourceId: createPlan.dataSourceId,
      databaseId: createPlan.databaseId,
    });
    return;
  }

  const pageId = normalizeNotionId(requireNonEmpty(options.page, "--page is required for append"));
  if (!pageId) {
    throw new Error("Could not extract a Notion page ID from --page");
  }

  if (options.dryRun) {
    printJson({
      action: "append",
      dryRun: true,
      pageId,
      blockCount: blocks.length,
      blocks,
    });
    return;
  }

  const token = getNotionToken();
  await appendBlocks({
    token,
    pageId,
    blocks,
  });

  printJson({
    action: "append",
    dryRun: false,
    pageId,
    pageUrl: toPageUrl(pageId),
    blockCount: blocks.length,
  });
}

function parseArguments(argv) {
  if (argv.length === 0 || ["help", "-h", "--help"].includes(argv[0])) {
    return { command: "help", options: {} };
  }

  const [command, ...rest] = argv;
  const options = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const key = toCamelCase(token.slice(2));
    if (key === "dryRun") {
      options.dryRun = true;
      continue;
    }

    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }
    options[key] = value;
    index += 1;
  }

  return { command, options };
}

function printUsage() {
  console.log(`Usage:
  node .agents/skills/notion-api-publisher/scripts/notion-api-publish.mjs create --title "Title" --content-file /tmp/note.md
  node .agents/skills/notion-api-publisher/scripts/notion-api-publish.mjs append --page "https://www.notion.so/..." --content-file /tmp/update.md

Options:
  --title                  Page title for create
  --content                Inline Markdown content
  --content-file           Markdown file path
  --page                   Page URL or page ID for append
  --data-source-id         Explicit data source ID or URL
  --database-id            Fallback database ID or URL
  --data-source-name       Preferred data source name when the database has multiple data sources
  --title-property-name    Override title property name; useful for dry runs
  --icon                   Emoji icon for newly created pages
  --dry-run                Parse Markdown and print the planned payload without calling Notion

Environment:
  NOTION_API_TOKEN
  NOTION_DOCUMENT_HUB_DATA_SOURCE_ID or NOTION_DOCUMENT_HUB_DATABASE_ID
  NOTION_API_VERSION (optional, default ${DEFAULT_NOTION_VERSION})
`);
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function requireNonEmpty(value, message) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(message);
  }
  return value.trim();
}

async function loadContent(options) {
  if (typeof options.content === "string") {
    return options.content;
  }
  if (typeof options.contentFile === "string") {
    return fs.readFile(options.contentFile, "utf8");
  }
  return "";
}

function getNotionToken() {
  const token = process.env.NOTION_API_TOKEN?.trim();
  if (!token) {
    throw new Error("Missing NOTION_API_TOKEN");
  }
  if (typeof fetch !== "function") {
    throw new Error("This script requires Node.js with global fetch support");
  }
  return token;
}

async function resolveCreatePlan(options) {
  const dataSourceInput =
    options.dataSourceId ?? process.env.NOTION_DOCUMENT_HUB_DATA_SOURCE_ID ?? null;
  const databaseInput =
    options.databaseId ?? process.env.NOTION_DOCUMENT_HUB_DATABASE_ID ?? null;
  const titlePropertyName = options.titlePropertyName?.trim() || null;

  const dataSourceId = normalizeNotionId(dataSourceInput);
  if (dataSourceId) {
    if (options.dryRun) {
      return {
        parentType: "data_source_id",
        dataSourceId,
        databaseId: null,
        titlePropertyName: titlePropertyName ?? "Name",
      };
    }

    const token = getNotionToken();
    return {
      parentType: "data_source_id",
      dataSourceId,
      databaseId: null,
      titlePropertyName:
        titlePropertyName ?? (await resolveTitlePropertyName(token, dataSourceId)),
    };
  }

  const databaseId = normalizeNotionId(databaseInput);
  if (databaseId) {
    if (options.dryRun) {
      return {
        parentType: "database_id",
        dataSourceId: null,
        databaseId,
        titlePropertyName: titlePropertyName ?? "Name",
      };
    }

    const token = getNotionToken();
    const dataSource = await resolveDataSourceFromDatabase(token, databaseId, options.dataSourceName);
    return {
      parentType: "data_source_id",
      dataSourceId: dataSource.id,
      dataSourceName: dataSource.name,
      databaseId,
      titlePropertyName:
        titlePropertyName ?? (await resolveTitlePropertyName(token, dataSource.id)),
    };
  }

  throw new Error(
    "Missing Notion destination. Set NOTION_DOCUMENT_HUB_DATA_SOURCE_ID or NOTION_DOCUMENT_HUB_DATABASE_ID, or pass --data-source-id/--database-id."
  );
}

async function resolveDataSourceFromDatabase(token, databaseId, preferredName) {
  const response = await notionRequest({
    token,
    method: "GET",
    path: `/databases/${databaseId}`,
  });

  const dataSources = Array.isArray(response.data_sources) ? response.data_sources : [];
  if (dataSources.length === 0) {
    throw new Error(`Database ${databaseId} did not return any data sources`);
  }

  if (preferredName) {
    const match = dataSources.find((item) => item.name === preferredName);
    if (!match) {
      throw new Error(
        `Database ${databaseId} does not contain a data source named "${preferredName}"`
      );
    }
    return match;
  }

  if (dataSources.length > 1) {
    throw new Error(
      `Database ${databaseId} has multiple data sources. Pass --data-source-name or use a direct data source ID.`
    );
  }

  return dataSources[0];
}

async function resolveTitlePropertyName(token, dataSourceId) {
  const response = await notionRequest({
    token,
    method: "GET",
    path: `/data_sources/${dataSourceId}`,
  });

  const properties = response.properties ?? {};
  for (const [propertyName, property] of Object.entries(properties)) {
    if (property?.type === "title") {
      return property.name ?? propertyName;
    }
  }

  throw new Error(`Could not find a title property for data source ${dataSourceId}`);
}

async function createPage({ token, title, icon, blocks, dataSourceId, titlePropertyName }) {
  if (!dataSourceId) {
    throw new Error("A resolved data source ID is required to create a page");
  }

  const page = await notionRequest({
    token,
    method: "POST",
    path: "/pages",
    body: {
      parent: {
        type: "data_source_id",
        data_source_id: dataSourceId,
      },
      properties: {
        [titlePropertyName]: {
          title: toPlainRichText(title),
        },
      },
      ...(icon
        ? {
            icon: {
              type: "emoji",
              emoji: icon,
            },
          }
        : {}),
    },
  });

  if (blocks.length > 0) {
    await appendBlocks({
      token,
      pageId: page.id,
      blocks,
    });
  }

  return page;
}

async function appendBlocks({ token, pageId, blocks }) {
  const chunks = chunk(blocks, 100);
  for (const children of chunks) {
    await notionRequest({
      token,
      method: "PATCH",
      path: `/blocks/${pageId}/children`,
      body: { children },
    });
  }
}

async function notionRequest({ token, method, path, body }) {
  const response = await fetch(`${NOTION_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": DEFAULT_NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.ok) {
    if (response.status === 204) {
      return null;
    }
    return response.json();
  }

  let detail = `${response.status} ${response.statusText}`;
  try {
    const payload = await response.json();
    if (payload?.code || payload?.message) {
      detail = `${detail}: ${payload.code ?? "error"} ${payload.message ?? ""}`.trim();
    }
  } catch {
    const text = await response.text();
    if (text) {
      detail = `${detail}: ${text}`;
    }
  }
  throw new Error(`Notion API request failed for ${method} ${path}: ${detail}`);
}

function normalizeNotionId(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  let candidate = value.trim();
  try {
    const url = new URL(candidate);
    candidate = url.pathname;
  } catch {
    candidate = candidate.split(/[?#]/, 1)[0];
  }

  const hyphenated = candidate.match(
    /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/
  );
  if (hyphenated) {
    return hyphenated[0].toLowerCase();
  }

  const compactMatches = candidate.match(/[0-9a-fA-F]{32}/g);
  if (!compactMatches || compactMatches.length === 0) {
    return null;
  }

  const compact = compactMatches[compactMatches.length - 1].toLowerCase();
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function toPageUrl(pageId) {
  return `https://www.notion.so/${pageId.replace(/-/g, "")}`;
}

function markdownToBlocks(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];

  for (let index = 0; index < lines.length; ) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const codeFence = line.match(/^```([\w#+.-]*)\s*$/);
    if (codeFence) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }

      blocks.push({
        object: "block",
        type: "code",
        code: {
          rich_text: toPlainRichText(codeLines.join("\n")),
          language: normalizeCodeLanguage(codeFence[1]),
        },
      });
      continue;
    }

    const imageMatch = line.match(/^!\[(.*?)]\((https?:\/\/[^)]+)\)\s*$/);
    if (imageMatch) {
      blocks.push({
        object: "block",
        type: "image",
        image: {
          type: "external",
          external: {
            url: imageMatch[2],
          },
          caption: imageMatch[1] ? inlineMarkdownToRichText(imageMatch[1]) : [],
        },
      });
      index += 1;
      continue;
    }

    if (/^---+\s*$/.test(line)) {
      blocks.push({
        object: "block",
        type: "divider",
        divider: {},
      });
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const headingLevel = Math.min(headingMatch[1].length, 3);
      const type = `heading_${headingLevel}`;
      blocks.push({
        object: "block",
        type,
        [type]: {
          rich_text: inlineMarkdownToRichText(headingMatch[2]),
        },
      });
      index += 1;
      continue;
    }

    if (/^\s*>\s+/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^\s*>\s+/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s+/, ""));
        index += 1;
      }
      blocks.push({
        object: "block",
        type: "quote",
        quote: {
          rich_text: inlineMarkdownToRichText(quoteLines.join("\n")),
        },
      });
      continue;
    }

    const todoMatch = line.match(/^\s*-\s+\[( |x|X)]\s+(.*)$/);
    if (todoMatch) {
      while (index < lines.length) {
        const currentMatch = lines[index].match(/^\s*-\s+\[( |x|X)]\s+(.*)$/);
        if (!currentMatch) {
          break;
        }
        blocks.push({
          object: "block",
          type: "to_do",
          to_do: {
            rich_text: inlineMarkdownToRichText(currentMatch[2]),
            checked: currentMatch[1].toLowerCase() === "x",
          },
        });
        index += 1;
      }
      continue;
    }

    const bulletMatch = line.match(/^\s*[-*]\s+(.*)$/);
    if (bulletMatch) {
      while (index < lines.length) {
        const currentMatch = lines[index].match(/^\s*[-*]\s+(.*)$/);
        if (!currentMatch || /^\s*-\s+\[( |x|X)]\s+/.test(lines[index])) {
          break;
        }
        blocks.push({
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: {
            rich_text: inlineMarkdownToRichText(currentMatch[1]),
          },
        });
        index += 1;
      }
      continue;
    }

    const numberedMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    if (numberedMatch) {
      while (index < lines.length) {
        const currentMatch = lines[index].match(/^\s*\d+\.\s+(.*)$/);
        if (!currentMatch) {
          break;
        }
        blocks.push({
          object: "block",
          type: "numbered_list_item",
          numbered_list_item: {
            rich_text: inlineMarkdownToRichText(currentMatch[1]),
          },
        });
        index += 1;
      }
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length && shouldStayInParagraph(lines[index])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }

    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: inlineMarkdownToRichText(paragraphLines.join("\n")),
      },
    });
  }

  return blocks;
}

function shouldStayInParagraph(line) {
  if (!line.trim()) {
    return false;
  }
  return !(
    /^```/.test(line) ||
    /^!\[(.*?)]\((https?:\/\/[^)]+)\)\s*$/.test(line) ||
    /^---+\s*$/.test(line) ||
    /^(#{1,6})\s+/.test(line) ||
    /^\s*>\s+/.test(line) ||
    /^\s*-\s+\[( |x|X)]\s+/.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line)
  );
}

function normalizeCodeLanguage(value) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return "plain text";
  }
  return CODE_LANGUAGE_ALIASES.get(normalized) ?? "plain text";
}

function inlineMarkdownToRichText(text) {
  if (!text) {
    return [];
  }

  const tokens = [];
  let cursor = 0;
  let plainBuffer = "";

  const flushPlainBuffer = () => {
    if (!plainBuffer) {
      return;
    }
    tokens.push({ type: "text", value: plainBuffer });
    plainBuffer = "";
  };

  while (cursor < text.length) {
    if (text.startsWith("**", cursor)) {
      const end = text.indexOf("**", cursor + 2);
      if (end !== -1) {
        flushPlainBuffer();
        tokens.push({
          type: "bold",
          value: text.slice(cursor + 2, end),
        });
        cursor = end + 2;
        continue;
      }
    }

    if (text[cursor] === "`") {
      const end = text.indexOf("`", cursor + 1);
      if (end !== -1) {
        flushPlainBuffer();
        tokens.push({
          type: "code",
          value: text.slice(cursor + 1, end),
        });
        cursor = end + 1;
        continue;
      }
    }

    if (text[cursor] === "*") {
      const end = text.indexOf("*", cursor + 1);
      if (end !== -1) {
        flushPlainBuffer();
        tokens.push({
          type: "italic",
          value: text.slice(cursor + 1, end),
        });
        cursor = end + 1;
        continue;
      }
    }

    if (text[cursor] === "[") {
      const closeLabel = text.indexOf("]", cursor + 1);
      if (closeLabel !== -1 && text[closeLabel + 1] === "(") {
        const closeUrl = text.indexOf(")", closeLabel + 2);
        if (closeUrl !== -1) {
          flushPlainBuffer();
          tokens.push({
            type: "link",
            value: text.slice(cursor + 1, closeLabel),
            url: text.slice(closeLabel + 2, closeUrl),
          });
          cursor = closeUrl + 1;
          continue;
        }
      }
    }

    plainBuffer += text[cursor];
    cursor += 1;
  }

  flushPlainBuffer();

  return tokens.flatMap((token) => {
    if (token.type === "bold") {
      return toPlainRichText(token.value, { bold: true });
    }
    if (token.type === "italic") {
      return toPlainRichText(token.value, { italic: true });
    }
    if (token.type === "code") {
      return toPlainRichText(token.value, { code: true });
    }
    if (token.type === "link") {
      return toPlainRichText(token.value, {}, token.url);
    }
    return toPlainRichText(token.value);
  });
}

function toPlainRichText(text, annotations = {}, link = null) {
  if (!text) {
    return [];
  }

  const result = [];
  for (const segment of splitText(text, 2000)) {
    result.push({
      type: "text",
      text: {
        content: segment,
        ...(link
          ? {
              link: {
                url: link,
              },
            }
          : {}),
      },
      annotations: {
        ...DEFAULT_TEXT_ANNOTATIONS,
        ...annotations,
      },
    });
  }
  return result;
}

function splitText(text, maxLength) {
  const parts = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    parts.push(remaining.slice(0, maxLength));
    remaining = remaining.slice(maxLength);
  }
  parts.push(remaining);
  return parts.filter((part) => part.length > 0);
}

function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
