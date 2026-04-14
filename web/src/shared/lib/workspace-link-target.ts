export type WorkspacePreviewPathKind = "file" | "directory" | "ambiguous";

export type WorkspaceHrefTarget =
  | {
      kind: "workspace";
      path: string;
      pathKind: WorkspacePreviewPathKind;
    }
  | {
      kind: "external";
      href: string;
    }
  | {
      kind: "invalid";
    };

const URL_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

function trimTrailingSlash(value: string): string {
  if (value === "/") {
    return value;
  }

  return value.replace(/\/+$/, "");
}

function stripHrefDecorations(value: string): string {
  const hashIndex = value.indexOf("#");
  const queryIndex = value.indexOf("?");
  const cutoff = [hashIndex, queryIndex]
    .filter((index) => index >= 0)
    .reduce((min, index) => Math.min(min, index), value.length);

  return value.slice(0, cutoff);
}

function normalizeRelativePath(value: string): string | null {
  const normalized = normalizeSlashes(value).trim();
  if (!normalized) {
    return "";
  }

  const parts = normalized.split("/");
  const resolved: string[] = [];

  for (const part of parts) {
    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      if (resolved.length === 0) {
        return null;
      }
      resolved.pop();
      continue;
    }

    resolved.push(part);
  }

  return resolved.join("/");
}

function normalizeAbsolutePath(value: string): string {
  const normalized = normalizeSlashes(safeDecode(value).trim());
  if (!normalized) {
    return "";
  }

  return trimTrailingSlash(normalized);
}

export function inferWorkspacePathKind(path: string): WorkspacePreviewPathKind {
  const normalized = normalizeSlashes(path);
  if (!normalized || normalized === ".") {
    return "directory";
  }

  if (normalized.endsWith("/")) {
    return "directory";
  }

  const leaf = normalized.split("/").at(-1) ?? "";
  if (!leaf) {
    return "directory";
  }

  if (leaf.startsWith(".") && !leaf.slice(1).includes(".")) {
    return "ambiguous";
  }

  return /\.[A-Za-z0-9][A-Za-z0-9._-]*$/.test(leaf) ? "file" : "ambiguous";
}

export function resolveWorkspaceHrefTarget(
  href: string | null | undefined,
  workspaceRoot: string
): WorkspaceHrefTarget {
  const trimmedHref = href?.trim() ?? "";
  if (!trimmedHref || trimmedHref === "#") {
    return { kind: "invalid" };
  }

  if (trimmedHref.startsWith("//")) {
    return {
      kind: "external",
      href: trimmedHref,
    };
  }

  if (URL_SCHEME_PATTERN.test(trimmedHref)) {
    if (/^file:/i.test(trimmedHref)) {
      const fileHref = trimmedHref.slice(trimmedHref.indexOf(":") + 1).replace(/^\/+/, "/");
      return resolveWorkspaceHrefTarget(fileHref, workspaceRoot);
    }

    return {
      kind: "external",
      href: trimmedHref,
    };
  }

  const decodedPath = safeDecode(stripHrefDecorations(trimmedHref));
  if (!decodedPath) {
    return { kind: "invalid" };
  }

  const normalizedWorkspaceRoot = normalizeAbsolutePath(workspaceRoot);
  if (!normalizedWorkspaceRoot) {
    return { kind: "invalid" };
  }

  const normalizedPath = normalizeSlashes(decodedPath);
  let workspacePath: string | null = null;

  if (normalizedPath.startsWith("/")) {
    const absolutePath = normalizeAbsolutePath(normalizedPath);
    const workspacePrefix = `${normalizedWorkspaceRoot}/`;
    if (absolutePath === normalizedWorkspaceRoot) {
      workspacePath = "";
    } else if (absolutePath.startsWith(workspacePrefix)) {
      workspacePath = absolutePath.slice(workspacePrefix.length);
    }
  } else {
    workspacePath = normalizeRelativePath(normalizedPath);
  }

  if (workspacePath === null) {
    return { kind: "invalid" };
  }

  return {
    kind: "workspace",
    path: workspacePath,
    pathKind: inferWorkspacePathKind(decodedPath),
  };
}

export function extractWorkspaceRelativeArtifactPath(
  artifactPath: string,
  artifactsDir: string
): string | null {
  const normalizedArtifactsDir = normalizeAbsolutePath(artifactsDir);
  const normalizedArtifactPath = normalizeAbsolutePath(artifactPath);
  if (!normalizedArtifactsDir || !normalizedArtifactPath) {
    return null;
  }

  const workspacePrefix = `${normalizedArtifactsDir}/workspace/`;
  if (!normalizedArtifactPath.startsWith(workspacePrefix)) {
    return null;
  }

  const relativePath = normalizedArtifactPath.slice(workspacePrefix.length);
  return relativePath || null;
}
