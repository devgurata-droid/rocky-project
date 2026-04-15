import { useMemo } from "react";

import { useTaskQuery } from "@/domains/task/hooks";
import type { AgentTaskRecord } from "@/domains/task/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { TaskResultPreview } from "./task-result-preview";

export function TaskResultDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: AgentTaskRecord | null;
}) {
  const taskQuery = useTaskQuery(props.task?.id);
  const task = useMemo(
    () => taskQuery.data ?? props.task,
    [props.task, taskQuery.data]
  );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-4xl rounded-4xl p-0">
        <div className="flex max-h-[88vh] flex-col overflow-hidden">
          <DialogHeader className="border-b border-border px-6 py-5">
            <DialogTitle>{task?.name ?? "단일 작업 결과"}</DialogTitle>
            <DialogDescription>
              가장 최근 단일 작업 실행 결과를 작업 세션처럼 바로 확인합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="custom-scrollbar overflow-y-auto px-6 py-5">
            <TaskResultPreview
              sessionId={task?.lastSessionId ?? null}
              runId={task?.lastRunId ?? null}
              status={task?.lastRunStatus ?? null}
              summary={task?.lastRunSummary ?? null}
              emptyTitle="아직 확인할 실행 결과가 없습니다."
              emptyDescription="수동 실행이나 자동 트리거 실행 후 이 화면에서 응답을 볼 수 있습니다."
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
