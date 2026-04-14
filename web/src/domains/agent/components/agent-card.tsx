import { useRef, useState } from "react";
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
  deriveAgentFocusAreas,
  getRunningTaskRequests,
  getTaskRequestLabel,
  getTaskRequestStatus,
  summarizeTaskRequests,
} from "@/domains/session/lib/request-status";
import { TaskRequestComposerDialog } from "@/domains/session/components/task-request-composer-dialog";
import { TaskRequestOverflowSurface } from "@/domains/session/components/task-request-overflow-surface";
import { TaskRequestStatusBadge } from "@/domains/session/components/task-request-status-badge";
import { buttonVariants } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { IconButton } from "@/shared/ui/icon-button";
import { AgentColorFan } from "./agent-color-fan";
import { cn } from "@/shared/lib/utils";
import type { AgentSummary } from "./agent-grid-view";

export function AgentCard({ agent }: { agent: AgentSummary }) {
  const updateMutation = useUpdateAgentMutation(agent.id);
  const sessionsQuery = useAgentSessionsQuery(agent.id, {
    includeArchived: true,
  });
  const cardRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [colorFanOpen, setColorFanOpen] = useState(false);
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const buttonsVisible = hovered || colorFanOpen;
  const canRequest = agent.lifecycle !== "archived";
  const focusAreas = deriveAgentFocusAreas(agent.description);
  const sessions = sessionsQuery.data ?? [];
  const requestSummary = summarizeTaskRequests(sessions);
  const runningRequests = getRunningTaskRequests(sessions);
  const featuredRunningRequests = runningRequests.slice(0, 2);
  const overflowRunningRequests = runningRequests.slice(2);
  const currentRequest = featuredRunningRequests[0] ?? null;
  const recentCompleted = requestSummary.recentCompleted;
  const latestRequest = currentRequest ?? requestSummary.pending ?? requestSummary.latest;

  function handleColorFanOpenChange(open: boolean) {
    setColorFanOpen(open);
    if (!open && cardRef.current && !cardRef.current.matches(":hover")) {
      setHovered(false);
    }
  }

  function handleToggleLifecycle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = agent.lifecycle === "archived" ? "active" : "archived";
    updateMutation.mutate({ lifecycle: next });
  }

  const cardStyle = agent.color
    ? {
        borderColor: `color-mix(in srgb, ${agent.color} 34%, var(--border))`,
        backgroundColor: `color-mix(in srgb, ${agent.color} 6%, var(--card))`,
        boxShadow:
          `0 0 0 1px color-mix(in srgb, ${agent.color} 14%, transparent), ` +
          `0 18px 32px color-mix(in srgb, ${agent.color} 10%, transparent)`,
      }
    : undefined;

  return (
    <div
      ref={cardRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        if (!colorFanOpen) setHovered(false);
      }}
      className={cn(
        "group relative rounded-lg border p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg",
        agent.lifecycle === "archived"
          ? "border-border/80 bg-muted/35"
          : agent.color
            ? "border"
            : "border-border/80 bg-card hover:border-foreground/10",
      )}
      style={cardStyle}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate text-base font-semibold text-foreground">{agent.name}</h4>
            {agent.lifecycle === "archived" ? (
              <Badge className="rounded-full bg-secondary text-secondary-foreground">
                보관됨
              </Badge>
            ) : null}
            {!sessionsQuery.isLoading && latestRequest ? (
              <TaskRequestStatusBadge status={getTaskRequestStatus(latestRequest)} />
            ) : null}
          </div>
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {agent.description || "자주 맡는 작업을 쌓아가며 점점 더 잘 맞는 방식으로 일합니다."}
          </p>
          {focusAreas.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {focusAreas.map((focus) => (
                <Badge
                  key={focus}
                  className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground"
                >
                  {focus}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>

        <div
          className={cn(
            "flex items-center gap-1 transition",
            buttonsVisible ? "opacity-100" : "opacity-0"
          )}
        >
          <AgentColorFan
            currentColor={agent.color}
            onSelect={(color) => updateMutation.mutate({ color })}
            disabled={updateMutation.isPending}
            groupHovered={hovered}
            onOpenChange={handleColorFanOpenChange}
          />
          <IconButton
            variant="ghost"
            size="sm"
            label={agent.lifecycle === "archived" ? "복원" : "보관"}
            onClick={handleToggleLifecycle}
            disabled={updateMutation.isPending}
          >
            {agent.lifecycle === "archived" ? <ArchiveRestore size={16} /> : <Archive size={16} />}
          </IconButton>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-border/70 bg-background/80 px-4 py-4">
          <div className="flex items-center gap-2 text-label-md uppercase text-muted-foreground">
            <Clock3 size={13} className="text-blue-600 dark:text-blue-300" />
            <span>지금 맡은 일</span>
          </div>
          <div className="mt-2 min-h-[2.75rem] space-y-2">
            {featuredRunningRequests.length > 0 ? (
              featuredRunningRequests.map((session) => (
                <Link
                  key={session.id}
                  to={`/agents/${agent.id}/sessions/${session.id}`}
                  className="block truncate text-sm font-semibold leading-6 text-foreground no-underline transition hover:text-primary"
                >
                  {getTaskRequestLabel(session)}
                </Link>
              ))
            ) : (
              <p className="text-sm font-semibold leading-6 text-foreground">
                현재 진행 중인 작업이 없습니다.
              </p>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {currentRequest ? (
              <TaskRequestStatusBadge status={getTaskRequestStatus(currentRequest)} />
            ) : (
              <Badge className="rounded-full bg-secondary text-secondary-foreground">
                {canRequest ? "요청 가능" : "요청 중지"}
              </Badge>
            )}
            {overflowRunningRequests.length > 0 ? (
              <TaskRequestOverflowSurface
                agentId={agent.id}
                requests={overflowRunningRequests}
              />
            ) : null}
          </div>
        </div>

        <div className="rounded-lg border border-border/70 bg-background/80 px-4 py-4">
          <div className="flex items-center gap-2 text-label-md uppercase text-muted-foreground">
            <CheckCircle2 size={13} className="text-emerald-600 dark:text-emerald-300" />
            <span>최근 완료</span>
          </div>
          <div className="mt-2 min-h-[2.75rem]">
            {recentCompleted ? (
              <Link
                to={`/agents/${agent.id}/sessions/${recentCompleted.id}`}
                className="line-clamp-2 text-sm font-semibold leading-6 text-foreground no-underline transition hover:text-primary"
              >
                {getTaskRequestLabel(recentCompleted)}
              </Link>
            ) : (
              <p className="text-sm font-semibold leading-6 text-foreground">
                아직 완료된 작업 기록이 없습니다.
              </p>
            )}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {recentCompleted
              ? new Date(recentCompleted.lastActivityAt).toLocaleString()
              : sessionsQuery.isLoading
                ? "작업 기록을 불러오는 중입니다."
                : "첫 작업 요청을 보내면 이 영역이 채워집니다."}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
        <p className="text-xs text-muted-foreground">
          {sessionsQuery.isLoading
            ? "작업 요약 불러오는 중"
            : `${requestSummary.counts.running} 진행 중 · ${requestSummary.counts.completed} 완료 · ${requestSummary.counts.failed} 실패`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
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
        </div>
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
