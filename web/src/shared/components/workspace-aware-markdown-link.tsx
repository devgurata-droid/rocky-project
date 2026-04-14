import type { ReactNode } from "react";

import {
  resolveWorkspaceHrefTarget,
  type WorkspacePreviewPathKind,
} from "@/shared/lib/workspace-link-target";

export function WorkspaceAwareMarkdownLink(props: {
  href?: string | null;
  workspaceRoot: string;
  onOpenWorkspacePath: (path: string, pathKind: WorkspacePreviewPathKind) => void;
  children: ReactNode;
  className: string;
}) {
  const target = resolveWorkspaceHrefTarget(props.href, props.workspaceRoot);

  if (target.kind === "workspace") {
    return (
      <button
        type="button"
        onClick={() => props.onOpenWorkspacePath(target.path, target.pathKind)}
        className={props.className}
      >
        {props.children}
      </button>
    );
  }

  if (target.kind === "external") {
    return (
      <a
        href={target.href}
        target="_blank"
        rel="noreferrer"
        className={props.className}
      >
        {props.children}
      </a>
    );
  }

  return <span>{props.children}</span>;
}
