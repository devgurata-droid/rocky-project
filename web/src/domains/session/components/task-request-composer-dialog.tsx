import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import {
  useCreateTaskRequestMutation,
} from "@/domains/session/hooks";
import { useRuntimesQuery } from "@/domains/codex/hooks";
import { ProviderGlyph } from "@/domains/codex/components/provider-glyph";
import {
  ollamaLaunchTargetLabel,
  runtimeLabel,
} from "@/domains/codex/lib/provider-display";
import {
  DEFAULT_SERVICE_TIER_SELECTION,
  resolveModelSelection,
  reasoningEffortLabel,
  resolveModelReasoningEffort,
  resolveModelServiceTier,
  serviceTierLabel,
} from "@/domains/codex/lib/runtime-model-options";
import type {
  RuntimeKind,
  RuntimeOllamaLaunchTarget,
} from "@/shared/lib/agent-engine-client";
import { Button } from "@/shared/ui/button";
import { CompactFileAttachmentPicker } from "@/domains/session/components/compact-file-attachment-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Textarea } from "@/shared/ui/textarea";
import {
  fileIdentity,
  mergeUniqueFiles,
} from "@/domains/session/lib/attachment-files";

interface TaskRequestComposerDialogProps {
  agentId: string;
  agentName: string;
  defaultRuntime: RuntimeKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TaskRequestComposerDialog({
  agentId,
  agentName,
  defaultRuntime,
  open,
  onOpenChange,
}: TaskRequestComposerDialogProps) {
  const navigate = useNavigate();
  const createTaskRequestMutation = useCreateTaskRequestMutation(agentId);
  const runtimesQuery = useRuntimesQuery();
  const [draftPrompt, setDraftPrompt] = useState("");
  const [selectedRuntime, setSelectedRuntime] = useState<RuntimeKind>(defaultRuntime);
  const [selectedOllamaLaunchTarget, setSelectedOllamaLaunchTarget] =
    useState<RuntimeOllamaLaunchTarget>("codex");
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState("");
  const [selectedServiceTier, setSelectedServiceTier] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  const normalizedPrompt = draftPrompt.trim();
  const runtimeDescriptor = useMemo(
    () => runtimesQuery.data?.find((runtime) => runtime.kind === selectedRuntime) ?? null,
    [selectedRuntime, runtimesQuery.data]
  );
  const selectedModelOption = useMemo(
    () => runtimeDescriptor?.modelOptions.find((model) => model.id === selectedModel) ?? null,
    [runtimeDescriptor, selectedModel]
  );

  useEffect(() => {
    setSelectedModel((current) => resolveModelSelection(runtimeDescriptor, current) || null);
  }, [runtimeDescriptor]);

  useEffect(() => {
    setSelectedReasoningEffort((current) =>
      resolveModelReasoningEffort(selectedModelOption, current)
    );
    setSelectedServiceTier((current) =>
      resolveModelServiceTier(selectedModelOption, current)
    );
  }, [selectedModelOption]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setDraftPrompt("");
      setSelectedRuntime(defaultRuntime);
      setSelectedOllamaLaunchTarget("codex");
      setSelectedFiles([]);
      setSelectionError(null);
      createTaskRequestMutation.reset();
    }

    onOpenChange(nextOpen);
  }

  function handleSelectedFiles(nextFiles: File[]) {
    if (nextFiles.length === 0) {
      return;
    }

    setSelectedFiles((current) => mergeUniqueFiles(current, nextFiles));
    setSelectionError(null);
    createTaskRequestMutation.reset();
  }

  function handleRemoveFile(fileToRemove: File) {
    setSelectedFiles((current) =>
      current.filter((file) => fileIdentity(file) !== fileIdentity(fileToRemove))
    );
    setSelectionError(null);
  }

  function handleRuntimeChange(nextRuntime: RuntimeKind) {
    const nextRuntimeDescriptor =
      runtimesQuery.data?.find((runtime) => runtime.kind === nextRuntime) ?? null;
    const nextModel = resolveModelSelection(nextRuntimeDescriptor, selectedModel);
    const nextModelOption =
      nextRuntimeDescriptor?.modelOptions.find((model) => model.id === nextModel) ?? null;

    setSelectedRuntime(nextRuntime);
    setSelectedModel(nextModel || null);
    setSelectedReasoningEffort(
      resolveModelReasoningEffort(nextModelOption, selectedReasoningEffort)
    );
    setSelectedServiceTier(resolveModelServiceTier(nextModelOption, selectedServiceTier));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!normalizedPrompt) {
      return;
    }

    const created = await createTaskRequestMutation.mutateAsync({
      prompt: normalizedPrompt,
      runtimeKind: selectedRuntime,
      ollamaLaunchTarget:
        selectedRuntime === "ollama" ? selectedOllamaLaunchTarget : null,
      model: selectedModel,
      reasoningEffort: selectedReasoningEffort || null,
      serviceTier:
        selectedServiceTier === DEFAULT_SERVICE_TIER_SELECTION
          ? null
          : selectedServiceTier || null,
      files: selectedFiles,
    });
    handleOpenChange(false);
    navigate(`/agents/${created.session.agentId}/sessions/${created.session.id}`);
  }

  const errorMessage =
    selectionError ||
    (createTaskRequestMutation.error instanceof Error
      ? createTaskRequestMutation.error.message
      : createTaskRequestMutation.isError
        ? "작업 요청 시작에 실패했습니다."
        : null);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl rounded-4xl p-0">
        <form onSubmit={handleSubmit} className="flex max-h-[90vh] flex-col overflow-hidden">
          <DialogHeader className="shrink-0 border-b border-border px-6 py-5">
            <DialogTitle>어떤 작업을 맡길까요?</DialogTitle>
            <DialogDescription>
              {agentName}에서 이번 작업에 사용할 엔진과 모델을 고른 뒤 작업을 시작할 수 있습니다.
            </DialogDescription>
          </DialogHeader>

          <div
            data-testid="task-request-dialog-body"
            className="min-h-0 flex-1 overflow-y-auto px-6 py-5"
          >
            <div className="space-y-5">
              <Label className="block">
                <span className="text-sm font-medium text-foreground">작업 요청 내용</span>
                <Textarea
                  value={draftPrompt}
                  onChange={(event) => setDraftPrompt(event.target.value)}
                  placeholder="예: 이번 주 경쟁사 3곳의 신규 기능을 비교해서 핵심 차이와 대응 아이디어를 정리해줘."
                  className="mt-2 min-h-40 rounded-3xl border-border bg-card px-4 py-4 text-sm leading-6"
                  autoFocus
                />
              </Label>

              <Label className="block">
                <span className="text-sm font-medium text-foreground">참고 파일</span>
                <div className="mt-2 rounded-3xl border border-border/70 bg-card/70 px-4 py-4">
                  <CompactFileAttachmentPicker
                    files={selectedFiles}
                    disabled={createTaskRequestMutation.isPending}
                    buttonLabel="참고 파일 업로드"
                    helperText="이미지, 문서, 코드 파일"
                    fileMetaSuffix="워크스페이스 참고 파일"
                    onFilesSelected={handleSelectedFiles}
                    onRemoveFile={handleRemoveFile}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    이미지 파일은 바로 첨부되고, 나머지 파일은 작업 공간에 올린 뒤 첫 요청과 함께 전달됩니다.
                  </p>
                </div>
              </Label>

              <div className="grid gap-4 md:grid-cols-2">
                <Label className="block md:col-span-2">
                  <span className="text-sm font-medium text-foreground">실행 엔진</span>
                  <div className="mt-2">
                    <Select
                      value={selectedRuntime}
                      onValueChange={(value) => handleRuntimeChange(value as RuntimeKind)}
                    >
                      <SelectTrigger className="w-full justify-between rounded-3xl border-border bg-card px-4">
                        <div className="flex items-center gap-2">
                          <ProviderGlyph
                            provider={
                              selectedRuntime === "codex-cli"
                                ? "codex"
                                : selectedRuntime === "claude-code"
                                  ? "claude"
                                  : "ollama"
                            }
                            className="size-5 text-[10px]"
                          />
                          <SelectValue>{runtimeLabel(selectedRuntime)}</SelectValue>
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
                </Label>

                {selectedRuntime === "ollama" ? (
                  <Label className="block md:col-span-2">
                    <span className="text-sm font-medium text-foreground">Ollama 실행기</span>
                    <div className="mt-2">
                      <Select
                        value={selectedOllamaLaunchTarget}
                        onValueChange={(value) =>
                          setSelectedOllamaLaunchTarget(value as RuntimeOllamaLaunchTarget)
                        }
                      >
                        <SelectTrigger className="w-full justify-between rounded-3xl border-border bg-card px-4">
                          <div className="flex items-center gap-2">
                            <ProviderGlyph
                              provider={selectedOllamaLaunchTarget}
                              className="size-5 text-[10px]"
                            />
                            <SelectValue>
                              {ollamaLaunchTargetLabel(selectedOllamaLaunchTarget)}
                            </SelectValue>
                          </div>
                        </SelectTrigger>
                        <SelectContent className="rounded-3xl">
                          {(["codex", "claude"] as RuntimeOllamaLaunchTarget[]).map((target) => (
                            <SelectItem key={target} value={target}>
                              <ProviderGlyph provider={target} className="size-5 text-[10px]" />
                              <span>{ollamaLaunchTargetLabel(target)}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </Label>
                ) : null}

                <Label className="block md:col-span-2">
                  <span className="text-sm font-medium text-foreground">실행 모델</span>
                  <div className="mt-2">
                    <Select
                      value={selectedModel ?? ""}
                      onValueChange={(value) => setSelectedModel(value)}
                      disabled={!runtimeDescriptor}
                    >
                      <SelectTrigger className="w-full justify-between rounded-3xl border-border bg-card px-4">
                        {selectedModelOption ? (
                          <div className="flex items-center gap-2">
                            <ProviderGlyph
                              provider={selectedModelOption.provider}
                              className="size-5 text-[10px]"
                            />
                            <SelectValue>{selectedModelOption.label}</SelectValue>
                          </div>
                        ) : (
                          <SelectValue placeholder="모델을 선택하세요" />
                        )}
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
                  <p className="mt-2 text-xs text-muted-foreground">
                    엔진: {runtimeDescriptor?.label ?? runtimeLabel(selectedRuntime)}
                  </p>
                </Label>

                {selectedModelOption?.supportedReasoningEfforts.length ? (
                  <Label className="block">
                    <span className="text-sm font-medium text-foreground">추론 수준</span>
                    <div className="mt-2">
                      <Select
                        value={selectedReasoningEffort}
                        onValueChange={(value) => setSelectedReasoningEffort(value ?? "")}
                      >
                        <SelectTrigger className="w-full justify-between rounded-3xl border-border bg-card px-4">
                          <SelectValue placeholder="추론 수준을 선택하세요" />
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
                      >
                        <SelectTrigger className="w-full justify-between rounded-3xl border-border bg-card px-4">
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

              {errorMessage ? (
                <div className="rounded-3xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {errorMessage}
                </div>
              ) : null}
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t border-border px-6 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              취소
            </Button>
            <Button
              type="submit"
              disabled={
                createTaskRequestMutation.isPending ||
                !normalizedPrompt ||
                !selectedModel
              }
            >
              {createTaskRequestMutation.isPending
                ? selectedFiles.length > 0
                  ? "파일 업로드 후 작업 요청 준비 중..."
                  : "작업 요청 준비 중..."
                : "작업 요청 시작"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
