import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Clock3,
  Sparkles,
} from "lucide-react";

import { useUpdateAgentMutation } from "../hooks";
import { useAgentSessionsQuery } from "@/domains/session/hooks";
import {
  getRunningTaskRequests,
  getTaskRequestLabel,
  getTaskRequestStatus,
  summarizeTaskRequests,
} from "@/domains/session/lib/request-status";
import { TaskRequestComposerDialog } from "@/domains/session/components/task-request-composer-dialog";
import { TaskRequestOverflowSurface } from "@/domains/session/components/task-request-overflow-surface";
import { TaskRequestStatusBadge } from "@/domains/session/components/task-request-status-badge";
import { Badge } from "@/shared/ui/badge";
import { IconButton } from "@/shared/ui/icon-button";
import { Button, buttonVariants } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import type { AgentSummary } from "./agent-grid-view";

export function AgentListItem({ agent }: { agent: AgentSummary }) {
  const updateMutation = useUpdateAgentMutation(agent.id);
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const sessionsQuery = useAgentSessionsQuery(agent.id, {
    includeArchived: true,
  });
  const sessions = sessionsQuery.data ?? [];
  const summary = summarizeTaskRequests(sessions);
  const runningRequests = getRunningTaskRequests(sessions);
  const featuredRunningRequests = runningRequests.slice(0, 2);
  const overflowRunningRequests = runningRequests.slice(2);
  const primaryRequest = featuredRunningRequests[0] ?? summary.pending ?? summary.latest;
  const recentCompleted = summary.recentCompleted;
  const canRequest = agent.lifecycle !== "archived";

  function handleToggleLifecycle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = agent.lifecycle === "archived" ? "active" : "archived";
    updateMutation.mutate({ lifecycle: next });
  }

  const cardStyle = agent.color
    ? {
        borderColor: `color-mix(in srgb, ${agent.color} 32%, var(--border))`,
        backgroundColor: `color-mix(in srgb, ${agent.color} 5%, var(--card))`,
        boxShadow:
          `0 0 0 1px color-mix(in srgb, ${agent.color} 12%, transparent), ` +
          `0 12px 24px color-mix(in srgb, ${agent.color} 8%, transparent)`,
      }
    : undefined;

  return (
    <div
      className={cn(
        "group flex flex-col gap-3 rounded-lg border px-4 py-4 shadow-sm transition-all duration-200 hover:-translate-y-px hover:shadow-md lg:flex-row lg:items-start lg:justify-between",
        agent.lifecycle === "archived"
          ? "border-border/80 bg-muted/30"
          : agent.color
            ? "border"
            : "border-border/80 bg-card hover:border-foreground/10",
      )}
      style={cardStyle}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="truncate text-sm font-semibold text-foreground">{agent.name}</h4>
          {agent.lifecycle === "archived" ? (
            <Badge className="rounded-full bg-secondary text-secondary-foreground">
              보관됨
            </Badge>
          ) : null}
          {primaryRequest ? (
            <TaskRequestStatusBadge status={getTaskRequestStatus(primaryRequest)} />
          ) : null}
        </div>

        <div className="mt-2 grid gap-2 text-sm text-muted-foreground lg:grid-cols-2">
          <div className="inline-flex min-w-0 items-center gap-2">
            <Clock3 size={13} className="text-blue-600 dark:text-blue-300" />
            {featuredRunningRequests.length > 0 ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {featuredRunningRequests.map((session) => (
                  <Link
                    key={session.id}
                    to={`/agents/${agent.id}/sessions/${session.id}`}
                    className="max-w-52 truncate text-muted-foreground no-underline transition hover:text-foreground"
                  >
                    {getTaskRequestLabel(session)}
                  </Link>
                ))}
                {overflowRunningRequests.length > 0 ? (
                  <TaskRequestOverflowSurface
                    agentId={agent.id}
                    requests={overflowRunningRequests}
                  />
                ) : null}
              </div>
            ) : (
              <span className="truncate">현재 진행 중인 작업 없음</span>
            )}
          </div>
          <div className="inline-flex min-w-0 items-center gap-2">
            <CheckCircle2 size={13} className="text-emerald-600 dark:text-emerald-300" />
            {recentCompleted ? (
              <Link
                to={`/agents/${agent.id}/sessions/${recentCompleted.id}`}
                className="truncate text-muted-foreground no-underline transition hover:text-foreground"
              >
                {getTaskRequestLabel(recentCompleted)}
              </Link>
            ) : (
              <span className="truncate">최근 완료 기록 없음</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        <Link
          to={`/agents/${agent.id}`}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          상세 보기
        </Link>
        <Button
          size="sm"
          onClick={() => setRequestDialogOpen(true)}
          disabled={!canRequest}
        >
          <Sparkles size={14} />
          작업 요청
        </Button>
        <IconButton
          variant="ghost"
          size="sm"
          label={agent.lifecycle === "archived" ? "복원" : "보관"}
          onClick={handleToggleLifecycle}
          disabled={updateMutation.isPending}
          className="shrink-0"
        >
          {agent.lifecycle === "archived" ? <ArchiveRestore size={16} /> : <Archive size={16} />}
        </IconButton>
      </div>

      <TaskRequestComposerDialog
        agentId={agent.id}
        agentName={agent.name}
        defaultRuntime={agent.defaultRuntime}
        open={requestDialogOpen}
        onOpenChange={setRequestDialogOpen}
      />
    </div>
  );
}
