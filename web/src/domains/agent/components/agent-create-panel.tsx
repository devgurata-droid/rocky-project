import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
import {
  DialogClose,
  DialogFooter,
} from "@/shared/ui/dialog";

const agentCreateSchema = z.object({
  name: z.string().min(1, "에이전트 이름은 필수입니다."),
  description: z.string(),
});

export type AgentCreateFormValues = z.infer<typeof agentCreateSchema>;

export function AgentCreatePanel(props: {
  onSubmit: (values: AgentCreateFormValues) => void;
  busy: boolean;
  error: string | null;
}) {
  const form = useForm<AgentCreateFormValues>({
    resolver: zodResolver(agentCreateSchema),
    defaultValues: { name: "", description: "" },
  });

  const nameValue = form.watch("name");
  const isDisabled = props.busy || !nameValue.trim();

  return (
    <form
      onSubmit={form.handleSubmit(props.onSubmit)}
      className="space-y-5"
    >
      <Label className="block">
        <span className="text-sm font-medium">이름</span>
        <Input
          type="text"
          {...form.register("name")}
          placeholder="예: 코드 리뷰어, 마케팅 어시스턴트"
          className="mt-1.5"
          autoFocus
        />
        {form.formState.errors.name ? (
          <p className="mt-1 text-xs text-destructive">
            {form.formState.errors.name.message}
          </p>
        ) : null}
      </Label>

      <Label className="block">
        <span className="text-sm font-medium">
          설명 <span className="font-normal text-muted-foreground">(선택)</span>
        </span>
        <Textarea
          rows={3}
          {...form.register("description")}
          placeholder="이 에이전트가 어떤 작업을 하는지 간단히 적어주세요"
          className="mt-1.5"
        />
      </Label>

      {props.error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {props.error}
        </div>
      ) : null}

      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>
          취소
        </DialogClose>
        <Button
          type="submit"
          disabled={isDisabled}
        >
          {props.busy ? "생성 중..." : "에이전트 생성"}
        </Button>
      </DialogFooter>
    </form>
  );
}
