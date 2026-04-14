import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpFromLine } from "lucide-react";

import { useRunResultQuery } from "@/domains/run/hooks";
import { RunEventsSource } from "@/domains/run/lib/run-events-source";
import { useTranscriptQuery } from "@/domains/session/hooks";
import type { AgentSessionMessage } from "@/shared/lib/agent-engine-client";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";

function toneForRole(role: "user" | "assistant"): string {
  return role === "assistant"
    ? "border-border/80 bg-card text-foreground"
    : "border-accent/70 bg-accent/80 text-accent-foreground";
}

function statusTone(status: string | null): string {
  if (status === "running") {
    return "bg-amber-500/12 text-amber-700";
  }

  if (status === "completed") {
    return "bg-emerald-500/12 text-emerald-700";
  }

  if (status === "failed") {
    return "bg-destructive/12 text-destructive";
  }

  if (status === "cancelled") {
    return "bg-secondary text-secondary-foreground";
  }

  return "bg-secondary text-secondary-foreground";
}

type ConversationMessage = AgentSessionMessage & {
  role: "user" | "assistant";
};

function isConversationMessage(
  message: AgentSessionMessage
): message is ConversationMessage {
  return message.role === "assistant" || message.role === "user";
}

export function TaskResultPreview(props: {
  sessionId: string | null;
  runId: string | null;
  status: string | null;
  summary?: string | null;
  compact?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const transcriptQuery = useTranscriptQuery(props.sessionId ?? undefined, {
    live: props.status === "running",
  });
  const runResultQuery = useRunResultQuery(
    props.status === "running" ? undefined : props.runId ?? undefined
  );
  const [pendingText, setPendingText] = useState("");
  const [liveConnected, setLiveConnected] = useState(false);

  useEffect(() => {
    setPendingText("");
    setLiveConnected(false);

    if (!props.runId || props.status !== "running") {
      return;
    }

    const source = new RunEventsSource(props.runId, {
      onOpen: () => setLiveConnected(true),
      onEvent: (event) => {
        if (event.type === "assistant.message.delta") {
          setPendingText((current) => current + String(event.data.text ?? ""));
          return;
        }

        if (event.type === "assistant.message.completed") {
          setPendingText("");
          void transcriptQuery.refetch();
          return;
        }

        if (event.type === "run.completed" || event.type === "run.error") {
          setLiveConnected(false);
          setPendingText("");
          void transcriptQuery.refetch();
        }
      },
      onError: () => {
        setLiveConnected(false);
      },
    });

    return () => source.close();
  }, [props.runId, props.status, transcriptQuery.refetch]);

  const transcriptMessages = useMemo(
    () => (transcriptQuery.data ?? []).filter(isConversationMessage),
    [transcriptQuery.data]
  );
  const visibleMessages = props.compact
    ? transcriptMessages.slice(-4)
    : transcriptMessages;
  const fallbackText =
    runResultQuery.data?.lastMessage ??
    runResultQuery.data?.messages.at(-1)?.text ??
    runResultQuery.data?.errors.at(0) ??
    props.summary ??
    null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={cn("rounded-full", statusTone(props.status))}>
          {props.status ?? "대기"}
        </Badge>
        {props.runId ? (
          <Link
            to={`/runs/${props.runId}`}
            className="inline-flex items-center gap-1 rounded-full border border-border/80 px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
          >
            <ArrowUpFromLine size={12} />
            대화 상세
          </Link>
        ) : null}
      </div>

      <div
        className={cn(
          "space-y-3 rounded-3xl border border-border/70 bg-muted/35 p-4",
          props.compact ? "max-h-96 overflow-y-auto" : "max-h-[52vh] overflow-y-auto"
        )}
      >
        {transcriptQuery.isLoading && visibleMessages.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border bg-background/80 px-4 py-6 text-sm text-muted-foreground">
            실행 결과를 불러오는 중입니다.
          </div>
        ) : null}

        {visibleMessages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "rounded-3xl border px-4 py-3",
              toneForRole(message.role)
            )}
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-60">
              {message.role === "assistant" ? "어시스턴트" : "작업 입력"}
            </div>
            <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">
              {message.content}
            </div>
          </div>
        ))}

        {props.status === "running" ? (
          <div className="rounded-3xl border border-border bg-card px-4 py-3 text-sm text-foreground">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-60">
              어시스턴트
            </div>
            <div className="mt-2 whitespace-pre-wrap break-words leading-6">
              {pendingText || (liveConnected ? "실행 중..." : "실행을 준비하고 있습니다.")}
            </div>
          </div>
        ) : null}

        {visibleMessages.length === 0 &&
        props.status !== "running" &&
        fallbackText ? (
          <div className="rounded-3xl border border-border bg-card px-4 py-3 text-sm text-foreground">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-60">
              어시스턴트
            </div>
            <div className="mt-2 whitespace-pre-wrap break-words leading-6">
              {fallbackText}
            </div>
          </div>
        ) : null}

        {visibleMessages.length === 0 &&
        props.status !== "running" &&
        !fallbackText &&
        !transcriptQuery.isLoading ? (
          <div className="rounded-3xl border border-dashed border-border bg-background/80 px-4 py-6">
            <div className="text-sm font-medium text-foreground">
              {props.emptyTitle ?? "아직 실행 결과가 없습니다."}
            </div>
            <div className="mt-2 text-sm leading-6 text-muted-foreground">
              {props.emptyDescription ??
                "단일 작업을 한 번 실행하면 여기에서 에이전트 응답을 바로 확인할 수 있습니다."}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
