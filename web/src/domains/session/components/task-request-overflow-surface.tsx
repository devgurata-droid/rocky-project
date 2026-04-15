import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Layers3 } from "lucide-react";

import type { AgentSessionRecord } from "@/domains/session/types";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { Button } from "@/shared/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/ui/drawer";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/shared/ui/popover";
import { cn } from "@/shared/lib/utils";
import { TaskRequestStatusBadge } from "./task-request-status-badge";
import { getTaskRequestLabel, getTaskRequestStatus } from "../lib/request-status";

interface TaskRequestOverflowSurfaceProps {
  agentId: string;
  requests: AgentSessionRecord[];
  onSelectRequest?: (session: AgentSessionRecord) => void;
}

function RequestList({
  agentId,
  requests,
  onNavigate,
  onSelectRequest,
}: {
  agentId: string;
  requests: AgentSessionRecord[];
  onNavigate: () => void;
  onSelectRequest?: (session: AgentSessionRecord) => void;
}) {
  return (
    <div className="space-y-2">
      {requests.map((session) => {
        const status = getTaskRequestStatus(session);
        const content = (
          <>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-foreground">
                {getTaskRequestLabel(session)}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <TaskRequestStatusBadge status={status} className="px-2 py-0.5" />
                <span>{new Date(session.lastActivityAt).toLocaleString()}</span>
              </div>
            </div>
            <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
          </>
        );

        if (onSelectRequest) {
          return (
            <button
              key={session.id}
              type="button"
              onClick={() => {
                onSelectRequest(session);
                onNavigate();
              }}
              className="flex w-full items-center justify-between gap-3 rounded-3xl border border-border bg-background px-4 py-3 text-left transition hover:bg-muted/50"
            >
              {content}
            </button>
          );
        }

        return (
          <Link
            key={session.id}
            to={`/agents/${agentId}/sessions/${session.id}`}
            onClick={onNavigate}
            className="flex items-center justify-between gap-3 rounded-3xl border border-border bg-background px-4 py-3 no-underline transition hover:bg-muted/50"
          >
            {content}
          </Link>
        );
      })}
    </div>
  );
}

export function TaskRequestOverflowSurface({
  agentId,
  requests,
  onSelectRequest,
}: TaskRequestOverflowSurfaceProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  if (requests.length === 0) {
    return null;
  }

  const trigger = (
    <Button
      variant="outline"
      size="xs"
      className={cn(
        "rounded-full border-border bg-background text-foreground shadow-sm hover:bg-muted hover:text-foreground"
      )}
    >
      +{requests.length}
    </Button>
  );

  if (isMobile) {
    return (
      <>
        <Button
          variant="outline"
          size="xs"
          className={cn(
            "rounded-full border-border bg-background text-foreground shadow-sm hover:bg-muted hover:text-foreground"
          )}
          onClick={() => setOpen(true)}
        >
          +{requests.length}
        </Button>
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>다른 진행 중 작업</DrawerTitle>
              <DrawerDescription>
                추가 진행 중 작업 {requests.length}개를 바로 열 수 있습니다.
              </DrawerDescription>
            </DrawerHeader>
            <div className="space-y-2 custom-scrollbar overflow-y-auto px-4 pb-4">
              <RequestList
                agentId={agentId}
                requests={requests}
                onNavigate={() => setOpen(false)}
                onSelectRequest={onSelectRequest}
              />
            </div>
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="end" className="w-[22rem] p-0">
        <PopoverHeader className="border-b border-border px-4 py-4">
          <PopoverTitle className="flex items-center gap-2">
            <Layers3 size={14} />
            다른 진행 중 작업
          </PopoverTitle>
          <PopoverDescription>
            추가 진행 중 작업 {requests.length}개를 바로 열 수 있습니다.
          </PopoverDescription>
        </PopoverHeader>
        <div className="max-h-[22rem] custom-scrollbar overflow-y-auto px-3 py-3">
          <RequestList
            agentId={agentId}
            requests={requests}
            onNavigate={() => setOpen(false)}
            onSelectRequest={onSelectRequest}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
