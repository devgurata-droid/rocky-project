import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ProviderGlyph } from "@/domains/codex/components/provider-glyph";
import { useRuntimesQuery } from "@/domains/codex/hooks";
import {
  ollamaLaunchTargetLabel,
  runtimeLabel,
} from "@/domains/codex/lib/provider-display";
import {
  DEFAULT_SERVICE_TIER_SELECTION,
  reasoningEffortLabel,
  resolveModelReasoningEffort,
  resolveModelSelection,
  resolveModelServiceTier,
  serviceTierLabel,
} from "@/domains/codex/lib/runtime-model-options";
import { useAgentMessengerSlotsQuery } from "@/domains/messenger/hooks";
import {
  useCreateTaskMutation,
  useRunTaskMutation,
  useTaskQuery,
  useUpdateTaskMutation,
} from "@/domains/task/hooks";
import type { AgentTaskRecord } from "@/domains/task/types";
import { agentEngineClient } from "@/shared/lib/api-client";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Textarea } from "@/shared/ui/textarea";
import { TaskResultPreview } from "./task-result-preview";

interface TaskEditorDialogProps {
  agentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: AgentTaskRecord | null;
  initialValues?: {
    name?: string;
    description?: string | null;
    prompt?: string;
    runtimeKind?: AgentTaskRecord["runtimeKind"];
    ollamaLaunchTarget?: AgentTaskRecord["ollamaLaunchTarget"];
    model?: string | null;
    reasoningEffort?: string | null;
    serviceTier?: string | null;
    sourceSessionId?: string | null;
    scheduleEnabled?: boolean;
    scheduleIntervalMinutes?: number | null;
    eventTriggerEnabled?: boolean;
    messengerDeliveryEnabled?: boolean;
    messengerDeliveryChatId?: string | null;
    messengerDeliveryThreadId?: string | null;
  } | null;
}

function buildWebhookUrl(task: AgentTaskRecord | null | undefined): string | null {
  if (!task?.eventTrigger.webhookToken) {
    return null;
  }

  return agentEngineClient.resolveApiPath(
    `/tasks/events/${encodeURIComponent(task.eventTrigger.webhookToken)}`
  );
}

export function TaskEditorDialog(props: TaskEditorDialogProps) {
  const runtimesQuery = useRuntimesQuery();
  const messengerSlotsQuery = useAgentMessengerSlotsQuery(props.agentId);
  const createTaskMutation = useCreateTaskMutation(props.agentId);
  const updateTaskMutation = useUpdateTaskMutation(props.agentId);
  const runTaskMutation = useRunTaskMutation(props.agentId);
  const [createdTaskId, setCreatedTaskId] = useState<string | null>(null);
  const taskQuery = useTaskQuery(props.task?.id ?? createdTaskId ?? undefined);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [runtimeKind, setRuntimeKind] = useState<AgentTaskRecord["runtimeKind"]>("codex-cli");
  const [ollamaLaunchTarget, setOllamaLaunchTarget] =
    useState<AgentTaskRecord["ollamaLaunchTarget"]>("codex");
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState("");
  const [selectedServiceTier, setSelectedServiceTier] = useState("");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleIntervalMinutes, setScheduleIntervalMinutes] = useState("60");
  const [eventTriggerEnabled, setEventTriggerEnabled] = useState(false);
  const [messengerDeliveryEnabled, setMessengerDeliveryEnabled] = useState(false);
  const [messengerChatId, setMessengerChatId] = useState("");
  const [messengerThreadId, setMessengerThreadId] = useState("");
  const [pendingAction, setPendingAction] = useState<"save" | "save-and-run" | null>(
    null
  );

  const task = taskQuery.data ?? props.task ?? null;
  const telegramSlot =
    messengerSlotsQuery.data?.slots.find((slot) => slot.provider === "telegram") ?? null;
  const telegramConnected = telegramSlot?.connection?.enabled === true;
  const runtimeDescriptor = useMemo(
    () => runtimesQuery.data?.find((runtime) => runtime.kind === runtimeKind) ?? null,
    [runtimeKind, runtimesQuery.data]
  );
  const selectedModelOption = useMemo(
    () =>
      runtimeDescriptor?.modelOptions.find((model) => model.id === selectedModel) ?? null,
    [runtimeDescriptor, selectedModel]
  );
  const busy =
    pendingAction !== null ||
    createTaskMutation.isPending ||
    updateTaskMutation.isPending ||
    runTaskMutation.isPending;
  const errorMessage =
    createTaskMutation.error instanceof Error
      ? createTaskMutation.error.message
      : updateTaskMutation.error instanceof Error
        ? updateTaskMutation.error.message
        : runTaskMutation.error instanceof Error
          ? runTaskMutation.error.message
        : null;
  const webhookUrl = buildWebhookUrl(task);
  const taskSourceVersion = task ? `${task.id}:${task.updatedAt}` : "new";
  const initialSourceVersion = props.initialValues
    ? JSON.stringify({
        name: props.initialValues.name ?? "",
        description: props.initialValues.description ?? "",
        prompt: props.initialValues.prompt ?? "",
        runtimeKind: props.initialValues.runtimeKind ?? "codex-cli",
        ollamaLaunchTarget: props.initialValues.ollamaLaunchTarget ?? "codex",
        model: props.initialValues.model ?? "",
        reasoningEffort: props.initialValues.reasoningEffort ?? "",
        serviceTier: props.initialValues.serviceTier ?? "",
        sourceSessionId: props.initialValues.sourceSessionId ?? "",
        scheduleEnabled: props.initialValues.scheduleEnabled ?? false,
        scheduleIntervalMinutes: props.initialValues.scheduleIntervalMinutes ?? "",
        eventTriggerEnabled: props.initialValues.eventTriggerEnabled ?? false,
        messengerDeliveryEnabled: props.initialValues.messengerDeliveryEnabled ?? false,
        messengerDeliveryChatId: props.initialValues.messengerDeliveryChatId ?? "",
        messengerDeliveryThreadId: props.initialValues.messengerDeliveryThreadId ?? "",
      })
    : "initial:null";

  useEffect(() => {
    if (!props.open) {
      setCreatedTaskId(null);
      setPendingAction(null);
      return;
    }

    const source = task
      ? {
          name: task.name,
          description: task.description,
          prompt: task.prompt,
          runtimeKind: task.runtimeKind,
          ollamaLaunchTarget: task.ollamaLaunchTarget,
          model: task.model,
          reasoningEffort: task.reasoningEffort,
          serviceTier: task.serviceTier,
          scheduleEnabled: task.schedule.enabled,
          scheduleIntervalMinutes: task.schedule.intervalMinutes,
          eventTriggerEnabled: task.eventTrigger.enabled,
          messengerDeliveryEnabled: task.messengerDelivery.enabled,
          messengerDeliveryChatId: task.messengerDelivery.chatId,
          messengerDeliveryThreadId: task.messengerDelivery.threadId,
        }
      : props.initialValues ?? null;

    setName(source?.name ?? "");
    setDescription(source?.description ?? "");
    setPrompt(source?.prompt ?? "");
    setRuntimeKind(source?.runtimeKind ?? "codex-cli");
    setOllamaLaunchTarget(source?.ollamaLaunchTarget ?? "codex");
    setSelectedModel(source?.model ?? "");
    setSelectedReasoningEffort(source?.reasoningEffort ?? "");
    setSelectedServiceTier(source?.serviceTier ?? "");
    setScheduleEnabled(source?.scheduleEnabled === true);
    setScheduleIntervalMinutes(
      source?.scheduleIntervalMinutes ? String(source.scheduleIntervalMinutes) : "60"
    );
    setEventTriggerEnabled(source?.eventTriggerEnabled === true);
    setMessengerDeliveryEnabled(source?.messengerDeliveryEnabled === true);
    setMessengerChatId(source?.messengerDeliveryChatId ?? "");
    setMessengerThreadId(source?.messengerDeliveryThreadId ?? "");
    createTaskMutation.reset();
    updateTaskMutation.reset();
    runTaskMutation.reset();
  }, [props.open, taskSourceVersion, initialSourceVersion]);

  useEffect(() => {
    setSelectedModel((current) => resolveModelSelection(runtimeDescriptor, current));
  }, [runtimeDescriptor]);

  useEffect(() => {
    setSelectedReasoningEffort((current) =>
      resolveModelReasoningEffort(selectedModelOption, current)
    );
    setSelectedServiceTier((current) =>
      resolveModelServiceTier(selectedModelOption, current)
    );
  }, [selectedModelOption]);

  function handleRuntimeKindChange(nextRuntimeKind: AgentTaskRecord["runtimeKind"]) {
    const nextRuntimeDescriptor =
      runtimesQuery.data?.find((runtime) => runtime.kind === nextRuntimeKind) ?? null;
    const nextModel = resolveModelSelection(nextRuntimeDescriptor, selectedModel);
    const nextModelOption =
      nextRuntimeDescriptor?.modelOptions.find((model) => model.id === nextModel) ?? null;

    setRuntimeKind(nextRuntimeKind);
    setSelectedModel(nextModel);
    setSelectedReasoningEffort((current) =>
      resolveModelReasoningEffort(nextModelOption, current)
    );
    setSelectedServiceTier((current) =>
      resolveModelServiceTier(nextModelOption, current)
    );
  }

  async function handleSubmit(mode: "save" | "save-and-run") {
    const normalizedName = name.trim();
    const normalizedPrompt = prompt.trim();
    const normalizedMessengerChatId = messengerChatId.trim();
    const normalizedMessengerThreadId = messengerThreadId.trim();

    if (!normalizedName || !normalizedPrompt) {
      return;
    }

    if (messengerDeliveryEnabled && !normalizedMessengerChatId) {
      toast.error("Telegram 전달을 켜려면 채팅 ID가 필요합니다.");
      return;
    }

    const payload = {
      name: normalizedName,
      description: description.trim() || null,
      prompt: normalizedPrompt,
      runtimeKind,
      ollamaLaunchTarget: runtimeKind === "ollama" ? ollamaLaunchTarget ?? "codex" : null,
      model: selectedModel || null,
      reasoningEffort: selectedReasoningEffort || null,
      serviceTier:
        selectedServiceTier === DEFAULT_SERVICE_TIER_SELECTION
          ? null
          : selectedServiceTier || null,
      sourceSessionId: props.initialValues?.sourceSessionId ?? null,
      schedule: {
        enabled: scheduleEnabled,
        intervalMinutes: scheduleEnabled
          ? Number.parseInt(scheduleIntervalMinutes, 10) || null
          : null,
      },
      eventTrigger: {
        enabled: eventTriggerEnabled,
      },
      messengerDelivery: {
        enabled: messengerDeliveryEnabled,
        chatId: normalizedMessengerChatId || null,
        threadId: normalizedMessengerThreadId || null,
      },
    };

    try {
      setPendingAction(mode);
      const savedTask = task
        ? await updateTaskMutation.mutateAsync({
            taskId: task.id,
            changes: payload,
          })
        : await createTaskMutation.mutateAsync(payload);

      if (mode === "save-and-run") {
        if (!task) {
          setCreatedTaskId(savedTask.id);
        }

        const taskRun = await runTaskMutation.mutateAsync(savedTask.id);
        toast.success(task ? "단일 작업을 업데이트하고 실행했습니다." : "단일 작업을 저장하고 실행했습니다.", {
          description: `${savedTask.name} 실행이 시작되었습니다.`,
          action: taskRun.runId
            ? {
                label: "대화 상세",
                onClick: () => {
                  window.location.href = `/runs/${taskRun.runId}`;
                },
              }
            : undefined,
        });
        return;
      }

      toast.success(task ? "단일 작업을 업데이트했습니다." : "단일 작업을 저장했습니다.");
      props.onOpenChange(false);
    } catch {
      // Surface inline error state from the mutation.
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-6xl rounded-4xl p-0">
        <div className="flex max-h-[90vh] flex-col overflow-hidden">
          <DialogHeader className="border-b border-border px-6 py-5">
            <DialogTitle>{task ? "단일 작업 편집" : "단일 작업 저장"}</DialogTitle>
            <DialogDescription>
              반복 실행할 작업 정의를 저장하고, 오른쪽 미리보기에서 최근 실행 결과를 바로 확인합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="min-h-0 custom-scrollbar overflow-y-auto border-b border-border px-6 py-5 lg:border-b-0 lg:border-r">
              <div className="space-y-5">
                <Label className="block">
                  <span className="text-sm font-medium text-foreground">작업 이름</span>
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="예: 스킬 설치 하네스 검증"
                    className="mt-2"
                  />
                </Label>

                <Label className="block">
                  <span className="text-sm font-medium text-foreground">설명</span>
                  <Textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    className="mt-2 min-h-24"
                    placeholder="이 단일 작업이 언제 재사용되는지 간단히 적습니다."
                  />
                </Label>

                <Label className="block">
                  <span className="text-sm font-medium text-foreground">실행 프롬프트</span>
                  <Textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    className="mt-2 min-h-64"
                    placeholder="이 단일 작업이 매번 수행할 고정 프롬프트를 작성합니다."
                  />
                </Label>

                <div className="rounded-3xl border border-border/70 bg-card/70 px-4 py-4">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="task-schedule-enabled"
                      checked={scheduleEnabled}
                      onCheckedChange={(checked) => setScheduleEnabled(checked === true)}
                    />
                    <div className="flex-1">
                      <Label htmlFor="task-schedule-enabled" className="text-sm font-medium">
                        주기 실행 활성화
                      </Label>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        저장된 프롬프트를 일정한 주기로 자동 실행합니다.
                      </p>
                      <Input
                        type="number"
                        min={1}
                        value={scheduleIntervalMinutes}
                        onChange={(event) => setScheduleIntervalMinutes(event.target.value)}
                        disabled={!scheduleEnabled || busy}
                        className="mt-3"
                        placeholder="60"
                      />
                      <p className="mt-1 text-xs text-muted-foreground">분 단위</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-border/70 bg-card/70 px-4 py-4">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="task-event-enabled"
                      checked={eventTriggerEnabled}
                      onCheckedChange={(checked) => setEventTriggerEnabled(checked === true)}
                    />
                    <div className="flex-1">
                      <Label htmlFor="task-event-enabled" className="text-sm font-medium">
                        Webhook 이벤트 트리거
                      </Label>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        외부 시스템이 HTTP POST로 이 작업을 직접 실행할 수 있습니다.
                      </p>
                      {webhookUrl ? (
                        <div className="mt-3 rounded-2xl bg-muted px-3 py-2 text-xs text-muted-foreground">
                          {webhookUrl}
                        </div>
                      ) : (
                        <p className="mt-3 text-xs text-muted-foreground">
                          저장 후 Webhook URL이 생성됩니다.
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-border/70 bg-card/70 px-4 py-4">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="task-messenger-enabled"
                      checked={messengerDeliveryEnabled}
                      onCheckedChange={(checked) => setMessengerDeliveryEnabled(checked === true)}
                    />
                    <div className="flex-1">
                      <Label htmlFor="task-messenger-enabled" className="text-sm font-medium">
                        Telegram으로 결과 전달
                      </Label>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        단일 작업이 끝나면 지정한 Telegram 채팅으로 결과를 전송합니다.
                      </p>
                      <div className="mt-3 grid gap-3">
                        <Input
                          value={messengerChatId}
                          onChange={(event) => setMessengerChatId(event.target.value)}
                          disabled={!messengerDeliveryEnabled || busy}
                          placeholder="채팅 ID 예: 123456789"
                        />
                        <Input
                          value={messengerThreadId}
                          onChange={(event) => setMessengerThreadId(event.target.value)}
                          disabled={!messengerDeliveryEnabled || busy}
                          placeholder="Thread ID (선택)"
                        />
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {telegramConnected
                          ? "이 에이전트의 Telegram 연결을 사용해 지정한 채팅으로 결과를 보냅니다."
                          : "먼저 채널 설정에서 Telegram 연결을 저장해야 합니다."}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="min-h-0 custom-scrollbar overflow-y-auto px-6 py-5">
              <div className="space-y-5">
                <div className="rounded-3xl border border-border/70 bg-card/70 px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    실행 설정
                  </p>

                  <div className="mt-4 space-y-4">
                    <Label className="block">
                      <span className="text-sm font-medium text-foreground">실행 엔진</span>
                      <div className="mt-2">
                        <Select
                          value={runtimeKind}
                          onValueChange={(value) =>
                            handleRuntimeKindChange(value as AgentTaskRecord["runtimeKind"])
                          }
                          disabled={busy}
                        >
                          <SelectTrigger className="w-full rounded-3xl">
                            <div className="flex items-center gap-2">
                              <ProviderGlyph
                                provider={
                                  runtimeKind === "codex-cli"
                                    ? "codex"
                                    : runtimeKind === "claude-code"
                                      ? "claude"
                                      : "ollama"
                                }
                                className="size-5 text-[10px]"
                              />
                              <SelectValue>{runtimeLabel(runtimeKind)}</SelectValue>
                            </div>
                          </SelectTrigger>
                          <SelectContent className="rounded-3xl">
                            {(runtimesQuery.data ?? []).map((runtime) => (
                              <SelectItem key={runtime.kind} value={runtime.kind}>
                                <ProviderGlyph
                                  provider={runtime.provider}
                                  className="size-5 text-[10px]"
                                />
                                <span>{runtime.label}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </Label>

                    {runtimeKind === "ollama" ? (
                      <Label className="block">
                        <span className="text-sm font-medium text-foreground">
                          Ollama 실행기
                        </span>
                        <div className="mt-2">
                          <Select
                            value={ollamaLaunchTarget ?? "codex"}
                            onValueChange={(value) =>
                              setOllamaLaunchTarget(
                                value as NonNullable<AgentTaskRecord["ollamaLaunchTarget"]>
                              )
                            }
                            disabled={busy}
                          >
                            <SelectTrigger className="w-full rounded-3xl">
                              <div className="flex items-center gap-2">
                                <ProviderGlyph
                                  provider={ollamaLaunchTarget === "claude" ? "claude" : "codex"}
                                  className="size-5 text-[10px]"
                                />
                                <SelectValue>
                                  {ollamaLaunchTargetLabel(ollamaLaunchTarget)}
                                </SelectValue>
                              </div>
                            </SelectTrigger>
                            <SelectContent className="rounded-3xl">
                              {(["codex", "claude"] as const).map((target) => (
                                <SelectItem key={target} value={target}>
                                  <ProviderGlyph
                                    provider={target}
                                    className="size-5 text-[10px]"
                                  />
                                  <span>{ollamaLaunchTargetLabel(target)}</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </Label>
                    ) : null}

                    <Label className="block">
                      <span className="text-sm font-medium text-foreground">모델</span>
                      <div className="mt-2">
                        <Select
                          value={selectedModel}
                          onValueChange={(value) => setSelectedModel(value ?? "")}
                          disabled={busy || !runtimeDescriptor}
                        >
                          <SelectTrigger className="w-full rounded-3xl">
                            {selectedModelOption ? (
                              <div className="flex items-center gap-2">
                                <ProviderGlyph
                                  provider={selectedModelOption.provider}
                                  className="size-5 text-[10px]"
                                />
                                <SelectValue>{selectedModelOption.label}</SelectValue>
                              </div>
                            ) : (
                              <SelectValue placeholder="모델 선택" />
                            )}
                          </SelectTrigger>
                          <SelectContent className="rounded-3xl">
                            {(runtimeDescriptor?.modelOptions ?? []).map((model) => (
                              <SelectItem key={model.id} value={model.id}>
                                <ProviderGlyph
                                  provider={model.provider}
                                  className="size-5 text-[10px]"
                                />
                                <span>{model.label}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </Label>

                    {selectedModelOption?.supportedReasoningEfforts.length ? (
                      <Label className="block">
                        <span className="text-sm font-medium text-foreground">추론 수준</span>
                        <div className="mt-2">
                          <Select
                            value={selectedReasoningEffort}
                            onValueChange={(value) => setSelectedReasoningEffort(value ?? "")}
                            disabled={busy}
                          >
                            <SelectTrigger className="w-full rounded-3xl">
                              <SelectValue placeholder="기본" />
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
                      </Label>
                    ) : null}

                    {selectedModelOption?.supportedServiceTiers.length ? (
                      <Label className="block">
                        <span className="text-sm font-medium text-foreground">응답 속도</span>
                        <div className="mt-2">
                          <Select
                            value={selectedServiceTier}
                            onValueChange={(value) => setSelectedServiceTier(value ?? "")}
                            disabled={busy}
                          >
                            <SelectTrigger className="w-full rounded-3xl">
                              <SelectValue placeholder="기본" />
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
                      </Label>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-3xl border border-border/70 bg-card/70 px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    실행 미리보기
                  </p>
                  <div className="mt-4">
                    <TaskResultPreview
                      sessionId={task?.lastSessionId ?? null}
                      runId={task?.lastRunId ?? null}
                      status={task?.lastRunStatus ?? null}
                      summary={task?.lastRunSummary ?? null}
                      compact
                      emptyTitle="아직 실행 기록이 없습니다."
                      emptyDescription="저장 후 단일 작업을 실행하면 최근 응답이 이 영역에 바로 표시됩니다."
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {errorMessage ? (
            <div className="mx-6 mb-4 rounded-3xl border border-destructive/30 bg-destructive/10 px-5 py-4 text-sm text-destructive">
              {errorMessage}
            </div>
          ) : null}

          <DialogFooter className="border-t border-border px-6 py-4">
            <Button
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              disabled={busy}
            >
              취소
            </Button>
            <Button
              variant="outline"
              onClick={() => void handleSubmit("save")}
              disabled={
                busy ||
                !name.trim() ||
                !prompt.trim() ||
                (messengerDeliveryEnabled && (!messengerChatId.trim() || !telegramConnected))
              }
            >
              {pendingAction === "save"
                ? task
                  ? "업데이트 중..."
                  : "저장 중..."
                : task
                  ? "단일 작업 업데이트"
                  : "단일 작업 저장"}
            </Button>
            <Button
              onClick={() => void handleSubmit("save-and-run")}
              disabled={
                busy ||
                !name.trim() ||
                !prompt.trim() ||
                (messengerDeliveryEnabled && (!messengerChatId.trim() || !telegramConnected))
              }
            >
              {pendingAction === "save-and-run"
                ? task
                  ? "업데이트 후 실행 중..."
                  : "저장 후 실행 중..."
                : task
                  ? "업데이트 후 실행"
                  : "저장 후 실행"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
