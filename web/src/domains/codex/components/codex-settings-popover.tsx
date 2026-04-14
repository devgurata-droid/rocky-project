import { Link } from "react-router-dom";
import { Settings2 } from "lucide-react";

import { SidebarMenuButton } from "@/shared/ui/sidebar";

export function CodexSettingsPopover() {
  return (
    <Link to="/account" className="block no-underline">
      <SidebarMenuButton tooltip="AI 서비스 설정" className="h-auto py-2">
        <Settings2 size={16} />
        <span className="flex-1 truncate text-xs group-data-[collapsible=icon]:hidden">
          AI 서비스 설정
        </span>
      </SidebarMenuButton>
    </Link>
  );
}
