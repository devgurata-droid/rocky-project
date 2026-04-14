import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";

import { useProviderAccountsQuery } from "../hooks";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { SidebarMenuButton, useSidebar } from "@/shared/ui/sidebar";

export function CodexSettingsMenu() {
  const navigate = useNavigate();
  const { isMobile, state } = useSidebar();
  const accountsQuery = useProviderAccountsQuery();
  const providers = accountsQuery.data?.providers ?? [];
  const neonStatus =
    providers.some((provider) => provider.status === "pending")
      ? "pending"
      : providers.some((provider) => provider.status === "authenticated")
        ? "active"
        : providers.some((provider) => provider.status === "error")
          ? "error"
          : "off";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
        <SidebarMenuButton className="h-auto py-2" aria-label="계정 연결하기">
          <Sparkles size={16} className="text-amber-500" />
          <span className="flex-1 truncate text-xs group-data-[collapsible=icon]:hidden">
            AI 서비스 연결
          </span>
          <span
            className="neon-dot shrink-0 group-data-[collapsible=icon]:hidden"
            data-status={neonStatus}
          />
        </SidebarMenuButton>
        }
        onClick={() => navigate("/account")}
      />
      <TooltipContent
        side="right"
        align="center"
        hidden={state !== "collapsed" || isMobile}
      >
        AI 서비스 연결
      </TooltipContent>
    </Tooltip>
  );
}
