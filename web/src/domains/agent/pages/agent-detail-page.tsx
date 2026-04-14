import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  Maximize2,
  MoreHorizontal,
  Send,
  Pencil,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { PageState } from "@/shared/components/page-state";
import {
  useAgentQuery,
  useDeleteAgentMutation,
  useUpdateAgentMutation,
} from "../hooks";
import {
  useAgentSessionsQuery,
  useDeleteSessionMutation,
  useSendMessageMutation,
  useTranscriptQuery,
  useUpdateSessionMutation,
  sessionQueryKeys,
} from "@/domains/session/hooks";
import { useRunQuery } from "@/domains/run/hooks";
import type {
  AgentSessionMessage,
  AgentSessionRecord,
} from "@/domains/session/types";
import type {
  RuntimeKind,
  RuntimeOllamaLaunchTarget,
} from "@/shared/lib/agent-engine-client";
import {
  deriveAgentFocusAreas,
  getRunningTaskRequests,
  getTaskRequestLabel,
  getTaskRequestStatus,
  sortTaskRequestsByRecentActivity,
  summarizeTaskRequests,
} from "@/domains/session/lib/request-status";
import { TaskRequestComposerDialog } from "@/domains/session/components/task-request-composer-dialog";
import { CompactFileAttachmentPicker } from "@/domains/session/components/compact-file-attachment-picker";
import { TaskRequestOverflowSurface } from "@/domains/session/components/task-request-overflow-surface";
import { TaskRequestStatusBadge } from "@/domains/session/components/task-request-status-badge";
import { ProviderGlyph } from "@/domains/codex/components/provider-glyph";
import { useRuntimesQuery } from "@/domains/codex/hooks";
import {
  DEFAULT_SERVICE_TIER_SELECTION,
  formatCompactRuntimeModelLabel,
  reasoningEffortLabel,
  resolveModelReasoningEffort,
  resolveModelSelection,
  resolveModelServiceTier,
  serviceTierLabel,
} from "@/domains/codex/lib/runtime-model-options";
import {
  ollamaLaunchTargetLabel,
  runtimeLabel,
  runtimeShortLabel,
} from "@/domains/codex/lib/provider-display";
import { AgentMessengerPanel } from "@/domains/messenger/components/agent-messenger-panel";
import { Badge } from "@/shared/ui/badge";
import { Button, buttonVariants } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { IconButton } from "@/shared/ui/icon-button";
import { Input } from "@/shared/ui/input";
import { ActionDropdownMenu } from "@/shared/ui/action-dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Textarea } from "@/shared/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { AgentTaskSection } from "@/domains/task/components/agent-task-section";
import { cn } from "@/shared/lib/utils";
import { toast } from "sonner";
import {
  fileIdentity,
  mergeUniqueFiles,
} from "@/domains/session/lib/attachment-files";

type AgentDetailTab = "requests" | "tasks" | "messenger";
type ConversationMessage = AgentSessionMessage & {
  role: "assistant" | "user";
};
type PreviewWindowPosition = {
  x: number;
  y: number;
};

type PreviewWindowDragState = {
  startX: number;
  startY: number;
  startOffset: PreviewWindowPosition;
  width: number;
  height: number;
};

function heroTone(agentArchived: boolean, hasRunningRequest: boolean): string {
  if (agentArchived) {
    return "보관됨";
  }

  if (hasRunningRequest) {
    return "작업 진행 중";
  }

  return "새 요청 가능";
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "아직 없음";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function transcriptRowTone(role: "assistant" | "user"): string {
  return role === "assistant"
    ? "border-border/80 bg-card text-foreground"
    : "border-accent/70 bg-accent/80 text-accent-foreground";
}

function isConversationMessage(
  message: AgentSessionMessage
): message is ConversationMessage {
  return message.role === "assistant" || message.role === "user";
}

function defaultPreviewOffset(stackDepth: number): PreviewWindowPosition {
  return {
    x: -Math.min(stackDepth * 32, 192),
    y: -Math.min(stackDepth * 24, 144),
  };
}

function clampPreviewOffset(
  next: PreviewWindowPosition,
  size: {
    width: number;
    height: number;
  }
): PreviewWindowPosition {
  const gutter = 12;
  const maxLeftShift = Math.max(window.innerWidth - size.width - gutter * 2, 0);
  const maxUpShift = Math.max(window.innerHeight - size.height - gutter * 2, 0);

  return {
    x: Math.min(0, Math.max(-maxLeftShift, next.x)),
    y: Math.min(0, Math.max(-maxUpShift, next.y)),
  };
}

function TaskRequestPreviewWindow(props: {
  agentId: string;
  session: AgentSessionRecord;
  stackDepth: number;
  zIndex: number;
  onFocus: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const requestStatus = getTaskRequestStatus(props.session);
  const sendMessageMutation = useSendMessageMutation(props.session.id);
  const runtimesQuery = useRuntimesQuery();
  const transcriptQuery = useTranscriptQuery(props.session.id, {
    live: requestStatus === "running",
  });
  const previewRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<PreviewWindowDragState | null>(null);
  const [offset, setOffset] = useState<PreviewWindowPosition>(() =>
    defaultPreviewOffset(props.stackDepth)
  );
  const [draftMessage, setDraftMessage] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedRuntime, setSelectedRuntime] = useState<RuntimeKind>(
    props.session.runtimeKind
  );
  const [selectedOllamaLaunchTarget, setSelectedOllamaLaunchTarget] =
    useState<RuntimeOllamaLaunchTarget>(
      props.session.runtimeConfig.ollamaLaunchTarget ?? "codex"
    );
  const [selectedModel, setSelectedModel] = useState(
    props.session.runtimeConfig.model ?? ""
  );
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState(
    props.session.runtimeConfig.reasoningEffort ?? ""
  );
  const [selectedServiceTier, setSelectedServiceTier] = useState(
    props.session.runtimeConfig.serviceTier ?? ""
  );
  const [sendError, setSendError] = useState<string | null>(null);
  const transcript = transcriptQuery.data ?? [];
  const conversationMessages = transcript.filter(isConversationMessage);
  const transcriptMessages = conversationMessages.slice(-8);
  const latestAssistantMessage =
    [...conversationMessages]
      .reverse()
      .find((message) => message.role === "assistant" && Boolean(message.runId)) ?? null;
  const latestAssistantRun = useRunQuery(latestAssistantMessage?.runId ?? undefined);
  const normalizedDraft = draftMessage.trim();
  const composerDisabled =
    props.session.lifecycle === "archived" ||
    requestStatus === "running" ||
    sendMessageMutation.isPending;
  const runtimeDescriptor =
    runtimesQuery.data?.find((runtime) => runtime.kind === selectedRuntime) ?? null;
  const selectedModelOption =
    runtimeDescriptor?.modelOptions.find((model) => model.id === selectedModel) ?? null;
  const selectedRuntimeLabel = runtimeDescriptor?.label ?? runtimeLabel(selectedRuntime);
  const compactModelLabel = selectedModel
    ? formatCompactRuntimeModelLabel(selectedModel)
    : runtimeDescriptor?.defaultModel
      ? formatCompactRuntimeModelLabel(runtimeDescriptor.defaultModel)
      : "모델 선택";
  const reasoningLabel = selectedReasoningEffort
    ? reasoningEffortLabel[
      selectedReasoningEffort as keyof typeof reasoningEffortLabel
    ] ?? selectedReasoningEffort
    : "기본";
  const latestAssistantRunRecord = latestAssistantRun.data;
  const latestResponseModel = latestAssistantRun.isLoading
    ? "확인 중"
    : latestAssistantRunRecord?.model
      ? formatCompactRuntimeModelLabel(latestAssistantRunRecord.model)
      : "아직 없음";
  const serviceTierLabelText =
    selectedRuntime === "ollama" || !selectedModelOption?.supportedServiceTiers.length
      ? null
      : serviceTierLabel[
        (selectedServiceTier || DEFAULT_SERVICE_TIER_SELECTION) as keyof typeof serviceTierLabel
      ];
  const settingsSummary = [
    selectedRuntimeLabel,
    selectedRuntime === "ollama"
      ? ollamaLaunchTargetLabel(selectedOllamaLaunchTarget)
      : reasoningLabel,
    serviceTierLabelText && serviceTierLabelText !== serviceTierLabel.default
      ? serviceTierLabelText
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  useEffect(() => {
    setSelectedRuntime(props.session.runtimeKind);
    setSelectedOllamaLaunchTarget(
      props.session.runtimeConfig.ollamaLaunchTarget ?? "codex"
    );
    setSelectedModel(props.session.runtimeConfig.model ?? "");
    setSelectedReasoningEffort(props.session.runtimeConfig.reasoningEffort ?? "");
    setSelectedServiceTier(props.session.runtimeConfig.serviceTier ?? "");
  }, [
    props.session.id,
    props.session.runtimeKind,
    props.session.runtimeConfig.ollamaLaunchTarget,
    props.session.runtimeConfig.model,
    props.session.runtimeConfig.reasoningEffort,
    props.session.runtimeConfig.serviceTier,
  ]);

  useEffect(() => {
    setSelectedModel((current) => resolveModelSelection(runtimeDescriptor, current) || "");
  }, [runtimeDescriptor]);

  useEffect(() => {
    setSelectedReasoningEffort((current) =>
      resolveModelReasoningEffort(selectedModelOption, current)
    );
    setSelectedServiceTier((current) =>
      resolveModelServiceTier(selectedModelOption, current)
    );
  }, [selectedModelOption]);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    const dragState = dragStateRef.current;

    if (!dragState) {
      return;
    }

    setOffset(
      clampPreviewOffset(
        {
          x: dragState.startOffset.x + (event.clientX - dragState.startX),
          y: dragState.startOffset.y + (event.clientY - dragState.startY),
        },
        {
          width: dragState.width,
          height: dragState.height,
        }
      )
    );
  }, []);

  const stopDragging = useCallback(() => {
    dragStateRef.current = null;
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", stopDragging);
    window.removeEventListener("pointercancel", stopDragging);
  }, [handlePointerMove]);

  useEffect(() => () => {
    stopDragging();
  }, [stopDragging]);

  function handleDragStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest("button, a, textarea, input")) {
      return;
    }

    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    props.onFocus();
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startOffset: offset,
      width: rect.width,
      height: rect.height,
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    event.preventDefault();
  }

  function handleSelectedFiles(nextFiles: File[]) {
    if (nextFiles.length === 0) {
      return;
    }

    setSelectedFiles((current) => mergeUniqueFiles(current, nextFiles));
    setSendError(null);
    if (sendMessageMutation.isError) {
      sendMessageMutation.reset();
    }
  }

  function handleRemoveFile(fileToRemove: File) {
    setSelectedFiles((current) =>
      current.filter((file) => fileIdentity(file) !== fileIdentity(fileToRemove))
    );
    setSendError(null);
  }

  function handleRuntimeChange(nextRuntime: RuntimeKind) {
    const nextRuntimeDescriptor =
      runtimesQuery.data?.find((runtime) => runtime.kind === nextRuntime) ?? null;
    const nextModel = resolveModelSelection(nextRuntimeDescriptor, selectedModel);
    const nextModelOption =
      nextRuntimeDescriptor?.modelOptions.find((model) => model.id === nextModel) ?? null;

    setSelectedRuntime(nextRuntime);
    setSelectedModel(nextModel || "");
    setSelectedReasoningEffort((current) =>
      resolveModelReasoningEffort(nextModelOption, current)
    );
    setSelectedServiceTier((current) => resolveModelServiceTier(nextModelOption, current));
  }

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!normalizedDraft || composerDisabled) {
      return;
    }

    try {
      await sendMessageMutation.mutateAsync({
        agentId: props.agentId,
        prompt: normalizedDraft,
        files: selectedFiles,
        runtimeKind: selectedRuntime,
        ollamaLaunchTarget:
          selectedRuntime === "ollama" ? selectedOllamaLaunchTarget : null,
        model: selectedModel || null,
        reasoningEffort:
          selectedRuntime === "ollama"
            ? null
            : selectedReasoningEffort || null,
        serviceTier:
          selectedRuntime === "ollama"
            ? null
            : selectedServiceTier || null,
      });
      setDraftMessage("");
      setSelectedFiles([]);
      setSendError(null);
      toast.success("메시지를 보냈습니다.");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: sessionQueryKeys.session(props.session.id),
        }),
        queryClient.invalidateQueries({
          queryKey: sessionQueryKeys.transcript(props.session.id),
        }),
        queryClient.invalidateQueries({
          queryKey: sessionQueryKeys.sessions(props.agentId, false),
        }),
        queryClient.invalidateQueries({
          queryKey: sessionQueryKeys.sessions(props.agentId, true),
        }),
      ]);
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "메시지를 전송하지 못했습니다.";
      setSendError(detail);
      toast.error("메시지 전송에 실패했습니다.", {
        description: detail,
      });
    }
  }

  const composerHint =
    props.session.lifecycle === "archived"
      ? "보관된 작업 요청이라 새 메시지를 보낼 수 없습니다."
      : requestStatus === "running"
        ? "현재 응답 중이라 완료 후 다음 메시지를 보낼 수 있습니다."
        : "이 창에서 바로 이어서 메시지를 보낼 수 있습니다.";
  const composerError =
    sendError ||
    (sendMessageMutation.error instanceof Error
      ? sendMessageMutation.error.message
      : null);

  return (
    <div
      ref={previewRef}
      data-testid={`agent-request-preview-window-${props.session.id}`}
      className="pointer-events-auto absolute right-3 bottom-3 h-[min(42rem,calc(100vh-1.5rem))] min-h-[24rem] w-[min(42rem,calc(100vw-1.5rem))] sm:min-h-[30rem] sm:min-w-[32rem]"
      style={{
        transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
        zIndex: props.zIndex,
      }}
      onPointerDownCapture={props.onFocus}
    >
      <Card className="h-full gap-0 border border-border bg-background/95 py-0 shadow-2xl backdrop-blur">
        <div
          className="flex cursor-grab touch-none items-start justify-between gap-3 border-b border-border px-3 py-2.5 active:cursor-grabbing"
          onPointerDown={handleDragStart}
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <TaskRequestStatusBadge status={requestStatus} />
              {props.session.lifecycle === "archived" ? (
                <Badge className="rounded-full bg-secondary text-secondary-foreground">
                  보관됨
                </Badge>
              ) : null}
              <Badge className="rounded-full bg-muted text-muted-foreground">
                {runtimeShortLabel(props.session.runtimeKind)}
              </Badge>
            </div>
            <h4 className="mt-1 truncate text-sm font-semibold text-foreground">
              {getTaskRequestLabel(props.session)}
            </h4>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span>응답</span>
                <span className="font-medium text-foreground/85">{latestResponseModel}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span>생성</span>
                <span>{formatDateTime(props.session.createdAt)}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span>활동</span>
                <span>{formatDateTime(props.session.lastActivityAt)}</span>
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Link
              to={`/agents/${props.agentId}/sessions/${props.session.id}`}
              aria-label="전체 작업 열기"
              className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "rounded-full")}
            >
              <Maximize2 size={14} />
            </Link>
            <IconButton
              size="sm"
              variant="ghost"
              label="미리보기 닫기"
              onClick={props.onClose}
            >
              <X size={14} />
            </IconButton>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {transcriptQuery.isLoading && transcriptMessages.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border bg-muted px-4 py-6 text-sm text-muted-foreground">
              작업 기록을 불러오는 중입니다.
            </div>
          ) : null}

          {transcriptQuery.isError ? (
            <div className="rounded-3xl border border-destructive/30 bg-destructive/10 px-4 py-6 text-sm text-destructive">
              {transcriptQuery.error instanceof Error
                ? transcriptQuery.error.message
                : "작업 기록을 불러오지 못했습니다."}
            </div>
          ) : null}

          {transcriptMessages.length === 0 &&
          !transcriptQuery.isLoading &&
          !transcriptQuery.isError ? (
            <div className="rounded-3xl border border-dashed border-border bg-muted px-4 py-6 text-sm text-muted-foreground">
              아직 대화 기록이 없습니다.
            </div>
          ) : null}

          <div className="space-y-3">
            {transcriptMessages.map((message) => (
              <div
                key={message.id}
                className={`rounded-3xl border px-4 py-3 ${transcriptRowTone(message.role)}`}
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-60">
                  {message.role === "assistant" ? "어시스턴트" : "작업 입력"}
                </div>
                <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">
                  {message.content || "텍스트 기록이 없습니다."}
                </div>
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={handleSendMessage} className="shrink-0 border-t border-border px-4 py-3">
          <div className="flex flex-col gap-3">
            <div
              data-testid="agent-request-preview-composer-body"
              className="max-h-[min(15rem,36vh)] space-y-3 overflow-y-auto pr-1"
            >
              {composerError ? (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {composerError}
                </div>
              ) : null}

              {selectedFiles.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {selectedFiles.map((file) => (
                    <div
                      key={fileIdentity(file)}
                      className="inline-flex min-w-0 shrink-0 items-center gap-2 rounded-full border border-border/70 bg-muted/60 px-3 py-1.5 text-[11px]"
                    >
                      <span className="block max-w-52 truncate font-medium text-foreground">
                        {file.name}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`${file.name} 제거`}
                        disabled={composerDisabled}
                        onClick={() => handleRemoveFile(file)}
                        className="shrink-0 rounded-full"
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">메시지 보내기</p>
                  <p className="text-xs text-muted-foreground">{selectedRuntimeLabel}</p>
                </div>
                <Textarea
                  aria-label="메시지 입력"
                  value={draftMessage}
                  onChange={(event) => {
                    setDraftMessage(event.target.value);
                    setSendError(null);
                    if (sendMessageMutation.isError) {
                      sendMessageMutation.reset();
                    }
                  }}
                  placeholder="이 작업 요청을 이어서 진행할 메시지를 입력합니다."
                  className="field-sizing-fixed h-28 min-h-28 overflow-y-auto rounded-2xl border-border bg-card px-4 py-3 text-sm leading-6"
                  disabled={composerDisabled}
                />
              </div>
            </div>

            <div
              data-testid="agent-request-preview-composer-actions"
              className="flex flex-wrap items-end justify-between gap-2 border-t border-border/70 pt-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Popover>
                  <PopoverTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        aria-label="엔진 및 모델 설정"
                        disabled={composerDisabled || !runtimeDescriptor}
                        className="h-9 max-w-full rounded-full border-border bg-muted/50 px-3 text-left shadow-none hover:bg-muted"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <ProviderGlyph
                            provider={selectedModelOption?.provider ?? runtimeDescriptor?.provider ?? "codex"}
                            className="size-5 shrink-0 text-[10px]"
                          />
                          <div className="min-w-0">
                            <div className="truncate text-xs font-medium text-foreground">
                              {compactModelLabel}
                            </div>
                            <div className="truncate text-[11px] text-muted-foreground">
                              {settingsSummary}
                            </div>
                          </div>
                          <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
                        </div>
                      </Button>
                    }
                  />
                  <PopoverContent
                    side="top"
                    align="start"
                    sideOffset={10}
                    className="w-[min(22rem,calc(100vw-2rem))] gap-3 rounded-[24px] p-3"
                  >
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-foreground">실행 설정</div>
                      <div className="text-[11px] text-muted-foreground">
                        이 메시지에만 사용할 엔진과 모델을 고릅니다.
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-medium text-muted-foreground">엔진</div>
                        <Select
                          value={selectedRuntime}
                          onValueChange={(value) =>
                            handleRuntimeChange(value as RuntimeKind)
                          }
                          disabled={composerDisabled}
                        >
                          <SelectTrigger
                            aria-label="실행 엔진"
                            className="h-9 w-full rounded-2xl border-border bg-muted/60 px-3 text-sm"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <ProviderGlyph
                                provider={runtimeDescriptor?.provider ?? "codex"}
                                className="size-4 shrink-0 text-[9px]"
                              />
                              <SelectValue className="truncate">
                                {selectedRuntimeLabel}
                              </SelectValue>
                            </div>
                          </SelectTrigger>
                          <SelectContent className="rounded-3xl">
                            {(runtimesQuery.data ?? []).map((runtime) => (
                              <SelectItem key={runtime.kind} value={runtime.kind}>
                                <ProviderGlyph provider={runtime.provider} className="size-5 text-[10px]" />
                                <span>{runtime.label}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {selectedRuntime === "ollama" ? (
                        <div className="space-y-1.5">
                          <div className="text-[11px] font-medium text-muted-foreground">
                            Ollama 실행기
                          </div>
                          <Select
                            value={selectedOllamaLaunchTarget}
                            onValueChange={(value) =>
                              setSelectedOllamaLaunchTarget(
                                value as RuntimeOllamaLaunchTarget
                              )
                            }
                            disabled={composerDisabled}
                          >
                            <SelectTrigger
                              aria-label="Ollama 실행기"
                              className="h-9 w-full rounded-2xl border-border bg-muted/60 px-3 text-sm"
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <ProviderGlyph
                                  provider={selectedOllamaLaunchTarget}
                                  className="size-4 shrink-0 text-[9px]"
                                />
                                <SelectValue className="truncate">
                                  {ollamaLaunchTargetLabel(selectedOllamaLaunchTarget)}
                                </SelectValue>
                              </div>
                            </SelectTrigger>
                            <SelectContent className="rounded-3xl">
                              {(["codex", "claude"] as RuntimeOllamaLaunchTarget[]).map(
                                (target) => (
                                  <SelectItem key={target} value={target}>
                                    <ProviderGlyph provider={target} className="size-5 text-[10px]" />
                                    <span>{ollamaLaunchTargetLabel(target)}</span>
                                  </SelectItem>
                                )
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : null}

                      <div className="space-y-1.5">
                        <div className="text-[11px] font-medium text-muted-foreground">모델</div>
                        <Select
                          value={selectedModel}
                          onValueChange={(value) => setSelectedModel(value ?? "")}
                          disabled={composerDisabled || !runtimeDescriptor}
                        >
                          <SelectTrigger
                            aria-label="모델"
                            className="h-9 w-full rounded-2xl border-border bg-muted/60 px-3 text-sm"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <ProviderGlyph
                                provider={selectedModelOption?.provider ?? runtimeDescriptor?.provider ?? "codex"}
                                className="size-4 shrink-0 text-[9px]"
                              />
                              <SelectValue className="truncate">
                                {selectedModelOption?.label ?? compactModelLabel}
                              </SelectValue>
                            </div>
                          </SelectTrigger>
                          <SelectContent className="rounded-3xl">
                            {(runtimeDescriptor?.modelOptions ?? []).map((model) => (
                              <SelectItem key={model.id} value={model.id}>
                                <ProviderGlyph provider={model.provider} className="size-5 text-[10px]" />
                                <span>{model.label}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {selectedModelOption?.supportedReasoningEfforts.length ? (
                        <div className="space-y-1.5">
                          <div className="text-[11px] font-medium text-muted-foreground">추론</div>
                          <Select
                            value={selectedReasoningEffort}
                            onValueChange={(value) => setSelectedReasoningEffort(value ?? "")}
                            disabled={composerDisabled}
                          >
                            <SelectTrigger
                              aria-label="추론 수준"
                              className="h-9 w-full rounded-2xl border-border bg-muted/60 px-3 text-sm"
                            >
                              <SelectValue placeholder="기본">
                                {reasoningLabel}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent className="rounded-3xl">
                              {selectedModelOption.supportedReasoningEfforts.map((effort) => (
                                <SelectItem key={effort} value={effort}>
                                  <span>{reasoningEffortLabel[effort]}</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : null}

                      {selectedModelOption?.supportedServiceTiers.length ? (
                        <div className="space-y-1.5">
                          <div className="text-[11px] font-medium text-muted-foreground">
                            응답 속도
                          </div>
                          <Select
                            value={selectedServiceTier}
                            onValueChange={(value) => setSelectedServiceTier(value ?? "")}
                            disabled={composerDisabled}
                          >
                            <SelectTrigger
                              aria-label="응답 속도"
                              className="h-9 w-full rounded-2xl border-border bg-muted/60 px-3 text-sm"
                            >
                              <SelectValue placeholder="기본">
                                {
                                  serviceTierLabel[
                                    (selectedServiceTier ||
                                      DEFAULT_SERVICE_TIER_SELECTION) as keyof typeof serviceTierLabel
                                  ]
                                }
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent className="rounded-3xl">
                              <SelectItem value={DEFAULT_SERVICE_TIER_SELECTION}>
                                <span>{serviceTierLabel.default}</span>
                              </SelectItem>
                              {selectedModelOption.supportedServiceTiers.map((tier) => (
                                <SelectItem key={tier} value={tier}>
                                  <span>{serviceTierLabel[tier]}</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : null}
                    </div>
                  </PopoverContent>
                </Popover>

                <CompactFileAttachmentPicker
                  files={selectedFiles}
                  disabled={composerDisabled}
                  buttonLabel="파일 추가"
                  inline
                  iconOnly
                  showFileList={false}
                  className="shrink-0"
                  onFilesSelected={handleSelectedFiles}
                  onRemoveFile={handleRemoveFile}
                />
              </div>

              <div className="flex items-center gap-3">
                <p className="text-xs text-muted-foreground">{composerHint}</p>
                <Button
                  type="submit"
                  size="sm"
                  disabled={composerDisabled || !normalizedDraft}
                >
                  <Send size={14} />
                  보내기
                </Button>
              </div>
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
}

export function AgentDetailPage() {
  const { agentId } = useParams();
  const navigate = useNavigate();
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<AgentDetailTab>("requests");
  const [showArchivedRequests, setShowArchivedRequests] = useState(false);
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);
  const [draftRequestTitle, setDraftRequestTitle] = useState("");
  const [editingAgentName, setEditingAgentName] = useState(false);
  const [draftAgentName, setDraftAgentName] = useState("");
  const [openRequestIds, setOpenRequestIds] = useState<string[]>([]);

  const agentQuery = useAgentQuery(agentId);
  const sessionsQuery = useAgentSessionsQuery(agentId, {
    includeArchived: true,
  });
  const updateAgentMutation = useUpdateAgentMutation(agentId);
  const deleteAgentMutation = useDeleteAgentMutation();
  const updateSessionMutation = useUpdateSessionMutation(agentId);
  const deleteSessionMutation = useDeleteSessionMutation(agentId);
  const allSessions = sessionsQuery.data ?? [];

  useEffect(() => {
    if (!agentQuery.data || editingAgentName) {
      return;
    }

    setDraftAgentName(agentQuery.data.name);
  }, [agentQuery.data, editingAgentName]);

  useEffect(() => {
    setOpenRequestIds((current) =>
      current.filter((sessionId) =>
        allSessions.some((session) => session.id === sessionId)
      )
    );
  }, [allSessions]);

  const openPreviewSessions = useMemo(() => {
    const sessionsById = new Map(allSessions.map((session) => [session.id, session]));
    return openRequestIds
      .map((sessionId) => sessionsById.get(sessionId))
      .filter((session): session is AgentSessionRecord => Boolean(session));
  }, [allSessions, openRequestIds]);

  function handleOpenRequestPreview(sessionId: string) {
    setOpenRequestIds((current) => [
      ...current.filter((id) => id !== sessionId),
      sessionId,
    ]);
  }

  function handleOpenRequestWorkspace(sessionId: string) {
    if (!agentId) {
      return;
    }

    navigate(`/agents/${agentId}/sessions/${sessionId}`);
  }

  function handleRequestCardKeyDown(
    event: ReactKeyboardEvent<HTMLDivElement>,
    sessionId: string
  ) {
    if (event.target !== event.currentTarget) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleOpenRequestPreview(sessionId);
    }
  }

  function handleCloseRequestPreview(sessionId: string) {
    setOpenRequestIds((current) => current.filter((id) => id !== sessionId));
  }

  async function handleSaveRequestTitle(sessionId: string) {
    await updateSessionMutation.mutateAsync({
      sessionId,
      changes: {
        title: draftRequestTitle.trim() || null,
      },
    });
    setEditingRequestId(null);
    setDraftRequestTitle("");
  }

  async function handleRequestLifecycleChange(
    sessionId: string,
    lifecycle: "active" | "archived"
  ) {
    const confirmed = window.confirm(
      lifecycle === "archived"
        ? "이 작업 요청을 보관하시겠습니까? 기록은 남지만 더 이상 새 입력을 받지 않습니다."
        : "이 작업 요청을 복구하시겠습니까? 다시 이어서 요청을 보낼 수 있습니다."
    );

    if (!confirmed) {
      return;
    }

    await updateSessionMutation.mutateAsync({
      sessionId,
      changes: {
        lifecycle,
      },
    });
  }

  async function handleDeleteRequest(session: {
    id: string;
    status: string;
  }) {
    const confirmed = window.confirm(
      session.status === "running"
        ? "진행 중인 작업 요청을 중지한 뒤 삭제하시겠습니까? 연결된 실행 기록과 아티팩트도 함께 제거됩니다."
        : "이 작업 요청 기록을 삭제하시겠습니까? 연결된 실행 기록과 아티팩트도 함께 제거됩니다."
    );

    if (!confirmed) {
      return;
    }

    await deleteSessionMutation.mutateAsync({
      sessionId: session.id,
      stopRunningRuns: true,
    });
  }

  async function handleAgentLifecycleChange(lifecycle: "active" | "archived") {
    const runningRequestCount =
      allSessions.filter((session) => session.status === "running").length ?? 0;
    const confirmed = window.confirm(
      lifecycle === "archived"
        ? runningRequestCount > 0
          ? `이 에이전트를 보관하시겠습니까? 진행 중인 작업 요청 ${runningRequestCount}개가 먼저 중지됩니다.`
          : "이 에이전트를 보관하시겠습니까? 복구 전까지 새 작업 요청이 차단됩니다."
        : "이 에이전트를 복구하시겠습니까?"
    );

    if (!confirmed) {
      return;
    }

    await updateAgentMutation.mutateAsync({
      lifecycle,
      stopRunningSessions: lifecycle === "archived" && runningRequestCount > 0,
    });
  }

  async function handleDeleteAgent(
    targetAgentId: string,
    archivedRequestCount: number,
    runningRequestCount: number
  ) {
    const confirmed = window.confirm(
      runningRequestCount > 0
        ? `이 에이전트를 삭제하시겠습니까? 진행 중인 작업 요청 ${runningRequestCount}개가 먼저 중지되고, 모든 기록이 제거됩니다.`
        : archivedRequestCount > 0
          ? `이 에이전트를 삭제하시겠습니까? 보관된 작업 요청 ${archivedRequestCount}개와 연결 기록이 함께 제거됩니다.`
          : "이 에이전트를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다."
    );

    if (!confirmed) {
      return;
    }

    await deleteAgentMutation.mutateAsync({
      agentId: targetAgentId,
      stopRunningSessions: runningRequestCount > 0,
    });
    navigate("/agents");
  }

  async function handleSaveAgentName() {
    const nextName = draftAgentName.trim();
    if (!nextName || !agentId) {
      return;
    }

    await updateAgentMutation.mutateAsync({
      name: nextName,
    });
    setEditingAgentName(false);
  }

  if (!agentId) {
    return (
      <PageState
        eyebrow="누락"
        title="에이전트 ID가 없습니다"
        description="에이전트 목록에서 다시 선택하세요."
      />
    );
  }

  if (agentQuery.isLoading || sessionsQuery.isLoading) {
    return (
      <PageState
        eyebrow="로딩"
        title="에이전트 화면을 준비하는 중입니다"
        description="에이전트 정보와 작업 요청 기록을 함께 불러오고 있습니다."
      />
    );
  }

  if (agentQuery.isError) {
    return (
      <PageState
        eyebrow="오류"
        title="에이전트를 불러올 수 없습니다"
        description={
          agentQuery.error instanceof Error
            ? agentQuery.error.message
            : "에이전트 상세 요청에 실패했습니다."
        }
      />
    );
  }

  const agent = agentQuery.data;
  const sessionsError = sessionsQuery.isError
    ? sessionsQuery.error instanceof Error
      ? sessionsQuery.error.message
      : "작업 요청 기록을 불러오지 못했습니다."
    : null;

  if (!agent) {
    return (
      <PageState
        eyebrow="누락"
        title="에이전트를 찾을 수 없습니다"
        description="요청한 에이전트가 현재 레지스트리에 존재하지 않습니다."
      />
    );
  }

  const requestSummary = summarizeTaskRequests(allSessions);
  const isArchivedAgent = agent.lifecycle === "archived";
  const filteredSessions =
    showArchivedRequests || isArchivedAgent
      ? allSessions
      : allSessions.filter((session) => session.lifecycle !== "archived");
  const visibleSessions = sortTaskRequestsByRecentActivity(filteredSessions);
  const activeSessions = allSessions.filter((session) => session.lifecycle !== "archived");
  const archivedSessions = allSessions.filter((session) => session.lifecycle === "archived");
  const runningSessions = getRunningTaskRequests(allSessions);
  const currentRequest = runningSessions[0] ?? null;
  const overflowRunningRequests = runningSessions.slice(1);
  const recentOutcome =
    requestSummary.recentCompleted ?? requestSummary.recentFailed ?? null;
  const latestRequest = requestSummary.latest;
  const focusAreas = deriveAgentFocusAreas(agent.description);
  const requestCountBadge =
    requestSummary.counts.total > 0
      ? `작업 요청 ${requestSummary.counts.total}개`
      : "작업 요청 없음";
  const mutationError =
    updateAgentMutation.isError
      ? updateAgentMutation.error instanceof Error
        ? updateAgentMutation.error.message
        : "에이전트 업데이트 요청에 실패했습니다."
      : deleteAgentMutation.isError
        ? deleteAgentMutation.error instanceof Error
          ? deleteAgentMutation.error.message
          : "에이전트 삭제 요청에 실패했습니다."
        : updateSessionMutation.isError
          ? updateSessionMutation.error instanceof Error
            ? updateSessionMutation.error.message
            : "작업 요청 업데이트 요청에 실패했습니다."
          : deleteSessionMutation.isError
            ? deleteSessionMutation.error instanceof Error
              ? deleteSessionMutation.error.message
              : "작업 요청 삭제 요청에 실패했습니다."
            : null;

  return (
    <section className="flex h-full min-h-0 flex-col gap-5 overflow-hidden">
      <Card className="shrink-0 gap-5 bg-foreground p-5 text-primary-foreground">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="rounded-full bg-card/8 text-primary-foreground">
                {heroTone(isArchivedAgent, runningSessions.length > 0)}
              </Badge>
              <Badge className="rounded-full bg-card/8 text-primary-foreground/80">
                {requestCountBadge}
              </Badge>
              <Badge className="rounded-full bg-card/8 text-primary-foreground/80">
                {agent.id}
              </Badge>
            </div>

            <div className="mt-4">
              {editingAgentName ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={draftAgentName}
                    onChange={(event) => setDraftAgentName(event.target.value)}
                    className="max-w-md rounded-2xl border-white/15 bg-white/8 text-primary-foreground placeholder:text-primary-foreground/40"
                    placeholder="에이전트 이름"
                  />
                  <IconButton
                    size="sm"
                    label="에이전트 이름 저장"
                    onClick={() => {
                      void handleSaveAgentName();
                    }}
                    disabled={updateAgentMutation.isPending}
                    className="bg-primary-foreground text-primary hover:bg-primary-foreground/90"
                  >
                    <Save size={14} />
                  </IconButton>
                  <IconButton
                    size="sm"
                    label="이름 변경 취소"
                    variant="outline"
                    onClick={() => {
                      setEditingAgentName(false);
                      setDraftAgentName(agent.name);
                    }}
                    className="border-white/15 bg-transparent text-primary-foreground hover:bg-white/8"
                  >
                    <X size={14} />
                  </IconButton>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="min-w-0 truncate font-heading text-headline-sm font-semibold">
                    {agent.name}
                  </h3>
                  <IconButton
                    size="sm"
                    label="에이전트 이름 변경"
                    variant="ghost"
                    onClick={() => setEditingAgentName(true)}
                    className="text-primary-foreground hover:bg-white/8 hover:text-primary-foreground"
                  >
                    <Pencil size={14} />
                  </IconButton>
                </div>
              )}

              <p className="mt-2 max-w-3xl text-sm leading-6 text-primary-foreground/80">
                {agent.description ||
                  "반복 작업과 누적된 기록을 바탕으로 계속 일하는 에이전트입니다."}
              </p>

              {focusAreas.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {focusAreas.map((focus) => (
                    <Badge
                      key={focus}
                      className="rounded-full border border-white/10 bg-white/8 px-2.5 py-1 text-primary-foreground"
                    >
                      {focus}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Button
              onClick={() => {
                setDetailTab("requests");
                setRequestDialogOpen(true);
              }}
              disabled={isArchivedAgent}
              variant={isArchivedAgent ? "outline" : "secondary"}
            >
              <Sparkles size={14} />
              작업 요청하기
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                void handleAgentLifecycleChange(isArchivedAgent ? "active" : "archived")
              }
              disabled={updateAgentMutation.isPending}
              className="border-white/15 bg-transparent text-primary-foreground hover:bg-white/8 hover:text-primary-foreground"
            >
              {isArchivedAgent ? <ArchiveRestore size={14} /> : <Archive size={14} />}
              {isArchivedAgent ? "복구" : "보관"}
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                void handleDeleteAgent(
                  agent.id,
                  archivedSessions.length,
                  runningSessions.length
                )
              }
              disabled={deleteAgentMutation.isPending}
            >
              <Trash2 size={14} />
              삭제
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl bg-card/6 px-4 py-3">
            <div className="text-label-md uppercase text-primary-foreground/60">
              현재 상태
            </div>
            <div className="mt-1 text-base font-medium text-primary-foreground">
              {heroTone(isArchivedAgent, runningSessions.length > 0)}
            </div>
          </div>

          <div className="rounded-2xl bg-card/6 px-4 py-3">
            <div className="text-label-md uppercase text-primary-foreground/60">
              진행 중 작업
            </div>
            <div className="mt-1 min-h-[2.25rem]">
              {currentRequest ? (
                <button
                  type="button"
                  onClick={() => handleOpenRequestPreview(currentRequest.id)}
                  className="line-clamp-2 text-left text-sm font-medium text-primary-foreground transition hover:text-white"
                >
                  {getTaskRequestLabel(currentRequest)}
                </button>
              ) : (
                <div className="text-sm font-medium text-primary-foreground">
                  현재 없음
                </div>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {currentRequest ? (
                <TaskRequestStatusBadge
                  status={getTaskRequestStatus(currentRequest)}
                  className="bg-card/10 text-primary-foreground"
                />
              ) : null}
              {overflowRunningRequests.length > 0 ? (
                <TaskRequestOverflowSurface
                  agentId={agent.id}
                  requests={overflowRunningRequests}
                  onSelectRequest={(session) => handleOpenRequestPreview(session.id)}
                />
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl bg-card/6 px-4 py-3">
            <div className="text-label-md uppercase text-primary-foreground/60">
              최근 결과
            </div>
            <div className="mt-1 min-h-[2.25rem]">
              {recentOutcome ? (
                <button
                  type="button"
                  onClick={() => handleOpenRequestPreview(recentOutcome.id)}
                  className="line-clamp-2 text-left text-sm font-medium text-primary-foreground transition hover:text-white"
                >
                  {getTaskRequestLabel(recentOutcome)}
                </button>
              ) : (
                <div className="text-sm font-medium text-primary-foreground">
                  기록 없음
                </div>
              )}
            </div>
            <div className="mt-2">
              {recentOutcome ? (
                <TaskRequestStatusBadge
                  status={getTaskRequestStatus(recentOutcome)}
                  className="bg-card/10 text-primary-foreground"
                />
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl bg-card/6 px-4 py-3">
            <div className="text-label-md uppercase text-primary-foreground/60">
              최근 활동
            </div>
            <div className="mt-1 text-sm font-medium text-primary-foreground">
              {latestRequest ? getTaskRequestLabel(latestRequest) : "아직 없음"}
            </div>
            <div className="mt-2 text-xs text-primary-foreground/70">
              {latestRequest
                ? `${formatDateTime(latestRequest.lastActivityAt)} · 활성 ${activeSessions.length}개`
                : "새 작업 요청을 바로 시작할 수 있습니다."}
            </div>
          </div>
        </div>
      </Card>

      {mutationError ? (
        <div className="shrink-0 rounded-3xl border border-destructive/30 bg-destructive/10 px-5 py-4 text-body-md text-destructive">
          {mutationError}
        </div>
      ) : null}

      <Tabs
        value={detailTab}
        onValueChange={(value) => setDetailTab(value as AgentDetailTab)}
        className="min-h-0 flex-1 gap-4 overflow-hidden"
      >
        <TabsList className="shrink-0 rounded-full bg-muted p-1">
          <TabsTrigger value="requests">작업 요청</TabsTrigger>
          <TabsTrigger value="tasks">단일 작업</TabsTrigger>
          <TabsTrigger value="messenger">메신저 연동</TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="min-h-0 overflow-hidden">
          <Card className="flex h-full min-h-0 flex-col gap-0 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-label-md uppercase text-muted-foreground">작업 요청</p>
                <h4 className="mt-2 text-headline-sm font-semibold text-foreground">
                  작업 요청 기록
                </h4>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  카드를 누르면 미리보기를 열고, 오른쪽 아이콘으로 전체 작업 화면으로 이동할 수
                  있습니다.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowArchivedRequests((current) => !current)}
                  disabled={isArchivedAgent}
                >
                  {showArchivedRequests ? "보관 항목 숨기기" : "보관 항목 보기"}
                </Button>
                <Button
                  onClick={() => setRequestDialogOpen(true)}
                  disabled={isArchivedAgent}
                >
                  <Sparkles size={14} />
                  새 요청
                </Button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Badge className="rounded-full bg-muted text-muted-foreground">
                전체 {requestSummary.counts.total}
              </Badge>
              <Badge className="rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                진행 중 {requestSummary.counts.running}
              </Badge>
              <Badge className="rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                완료 {requestSummary.counts.completed}
              </Badge>
              <Badge className="rounded-full bg-secondary text-secondary-foreground">
                보관 {requestSummary.counts.archived}
              </Badge>
            </div>

            {isArchivedAgent ? (
              <div className="mt-5 shrink-0 rounded-2xl border border-border bg-secondary px-4 py-3 text-body-md text-secondary-foreground">
                이 에이전트는 보관되었습니다. 기록은 계속 볼 수 있지만 복구 전까지 새 작업 요청은 받을 수 없습니다.
              </div>
            ) : null}

            <div className="mt-5 min-h-0 flex-1 overflow-hidden">
              {sessionsError ? (
                <div className="shrink-0 rounded-3xl border border-border bg-secondary px-5 py-5 text-body-md text-secondary-foreground">
                  작업 요청 기록을 새로고침할 수 없습니다: {sessionsError}
                </div>
              ) : null}

              {visibleSessions.length === 0 ? (
                <div className={cn(
                  "rounded-3xl border border-dashed border-border bg-muted px-5 py-8 text-body-md text-muted-foreground",
                  sessionsError ? "mt-4" : "",
                )}>
                  {isArchivedAgent
                    ? "보관된 작업 요청 기록이 없습니다. 이 에이전트를 다시 쓰려면 먼저 복구하세요."
                    : showArchivedRequests
                      ? "현재 조건과 맞는 작업 요청이 없습니다."
                      : "아직 작업 요청 기록이 없습니다. 위에서 첫 요청을 시작해 보세요."}
                </div>
              ) : (
                <div
                  data-testid="agent-detail-request-list"
                  className={cn(
                    "min-h-0 h-full space-y-3 overflow-y-auto pr-1",
                    sessionsError ? "mt-4" : "",
                  )}
                >
                  {visibleSessions.map((session) => {
                    const requestStatus = getTaskRequestStatus(session);
                    const isEditing = editingRequestId === session.id;
                    const requestActionItems = [
                      {
                        key: "rename",
                        label: "작업 이름 변경",
                        icon: <Pencil size={14} />,
                        onSelect: () => {
                          setEditingRequestId(session.id);
                          setDraftRequestTitle(session.title ?? "");
                        },
                      },
                      {
                        key: "archive",
                        label:
                          session.lifecycle === "archived"
                            ? "작업 요청 복구"
                            : "작업 요청 보관",
                        icon:
                          session.lifecycle === "archived" ? (
                            <ArchiveRestore size={14} />
                          ) : (
                            <Archive size={14} />
                          ),
                        disabled:
                          updateSessionMutation.isPending || session.status === "running",
                        onSelect: () => {
                          void handleRequestLifecycleChange(
                            session.id,
                            session.lifecycle === "archived" ? "active" : "archived"
                          );
                        },
                      },
                      {
                        key: "delete",
                        label: "작업 요청 삭제",
                        icon: <Trash2 size={14} />,
                        disabled: deleteSessionMutation.isPending,
                        variant: "destructive" as const,
                        onSelect: () => {
                          void handleDeleteRequest(session);
                        },
                      },
                    ];

                    return (
                      <div
                        key={session.id}
                        data-testid={`agent-request-card-${session.id}`}
                        role={isEditing ? undefined : "button"}
                        tabIndex={isEditing ? undefined : 0}
                        onClick={
                          isEditing
                            ? undefined
                            : () => handleOpenRequestPreview(session.id)
                        }
                        onKeyDown={
                          isEditing
                            ? undefined
                            : (event) => handleRequestCardKeyDown(event, session.id)
                        }
                        className={cn(
                          "rounded-2xl border border-border px-4 py-4",
                          isEditing
                            ? ""
                            : "cursor-pointer transition hover:border-border/80 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        )}
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div className="min-w-0 flex-1">
                            {isEditing ? (
                              <div className="space-y-2.5">
                                <Input
                                  type="text"
                                  value={draftRequestTitle}
                                  onChange={(event) =>
                                    setDraftRequestTitle(event.target.value)
                                  }
                                  placeholder="작업 요청 이름"
                                  className="rounded-2xl border-border bg-card px-4 py-2.5 text-body-md"
                                />
                                <div className="flex flex-wrap gap-2">
                                  <IconButton
                                    type="button"
                                    size="sm"
                                    disabled={updateSessionMutation.isPending}
                                    label="작업 이름 저장"
                                    onClick={() => {
                                      void handleSaveRequestTitle(session.id);
                                    }}
                                  >
                                    <Save size={14} />
                                  </IconButton>
                                  <IconButton
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      setEditingRequestId(null);
                                      setDraftRequestTitle("");
                                    }}
                                    label="이름 변경 취소"
                                  >
                                    <X size={14} />
                                  </IconButton>
                                </div>
                              </div>
                            ) : (
                              <div className="min-w-0 flex-1">
                                <div className="text-body-md font-semibold text-foreground">
                                  {getTaskRequestLabel(session)}
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-label-md text-muted-foreground">
                                  <span>{formatDateTime(session.lastActivityAt)}</span>
                                  <span>{runtimeLabel(session.runtimeKind)}</span>
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 md:justify-end">
                            <TaskRequestStatusBadge status={requestStatus} />
                            {session.lifecycle === "archived" ? (
                              <Badge className="rounded-full bg-secondary text-secondary-foreground">
                                보관됨
                              </Badge>
                            ) : null}

                            {isEditing ? null : (
                              <div className="flex flex-wrap gap-1.5 md:justify-end">
                                <IconButton
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  data-testid={`agent-request-session-trigger-${session.id}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleOpenRequestWorkspace(session.id);
                                  }}
                                  label="작업 요청 세션 열기"
                                >
                                  <Maximize2 size={14} />
                                </IconButton>

                                <ActionDropdownMenu
                                  trigger={
                                    <IconButton
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                      }}
                                      label="작업 요청 더보기"
                                    >
                                      <MoreHorizontal size={14} />
                                    </IconButton>
                                  }
                                  items={requestActionItems}
                                  contentClassName="w-52"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="tasks" className="min-h-0 overflow-hidden">
          <AgentTaskSection agentId={agent.id} />
        </TabsContent>

        <TabsContent value="messenger" className="min-h-0 overflow-hidden">
          <AgentMessengerPanel agentId={agent.id} />
        </TabsContent>
      </Tabs>

      {openPreviewSessions.length > 0 ? (
        <div
          data-testid="agent-request-preview-stack"
          className="pointer-events-none fixed inset-0 z-40 overflow-hidden"
        >
          {openPreviewSessions.map((session, index) => (
            <TaskRequestPreviewWindow
              key={session.id}
              agentId={agent.id}
              session={session}
              stackDepth={openPreviewSessions.length - 1 - index}
              zIndex={100 + index}
              onFocus={() => handleOpenRequestPreview(session.id)}
              onClose={() => handleCloseRequestPreview(session.id)}
            />
          ))}
        </div>
      ) : null}

      <TaskRequestComposerDialog
        agentId={agent.id}
        agentName={agent.name}
        defaultRuntime={agent.defaultRuntime}
        open={requestDialogOpen}
        onOpenChange={setRequestDialogOpen}
      />
    </section>
  );
}
