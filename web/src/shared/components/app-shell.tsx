import { Outlet, useLocation } from "react-router-dom";

import { cn } from "@/shared/lib/utils";
import { NavAgents } from "@/domains/agent/components/nav-agents";
import { CodexUsageBars } from "@/domains/codex/components/codex-usage-bars";
import { CodexSettingsMenu } from "@/domains/codex/components/codex-settings-menu";
import { Separator } from "@/shared/ui/separator";
import { SidebarLogo } from "./sidebar-logo";
import { SiteHeader } from "./site-header";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
} from "@/shared/ui/sidebar";

function isCompactRoute(pathname: string): boolean {
  return pathname.startsWith("/agents/") && pathname.includes("/sessions/");
}

function isAgentDetailRoute(pathname: string): boolean {
  return /^\/agents\/[^/]+$/.test(pathname);
}

function usesBoundedCanvas(pathname: string): boolean {
  return pathname === "/agents" || isAgentDetailRoute(pathname) || isCompactRoute(pathname);
}

export function AppShell() {
  const location = useLocation();
  const boundedCanvas = usesBoundedCanvas(location.pathname);
  const compactRoute = isCompactRoute(location.pathname);

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="px-3 py-4">
          <SidebarLogo />
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <NavAgents />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup className="mt-auto">
            <SidebarGroupContent>
              <CodexUsageBars />
              <Separator className="w-full my-2" />
              <SidebarMenu>
                <SidebarMenuItem>
                  <CodexSettingsMenu />
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <SidebarInset>
        <SiteHeader />

        <div
          className={cn(
            "min-h-0 flex-1",
            boundedCanvas
              ? cn(
                "box-border flex h-[calc(100svh-3rem)] max-h-[calc(100svh-3rem)] min-h-0 flex-col overflow-hidden",
                compactRoute ? "p-5 md:p-6" : "p-8 md:p-10",
              )
              : "overflow-y-auto p-8 md:p-10",
          )}
        >
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
