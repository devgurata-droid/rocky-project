import { RouterProvider } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/shared/ui/sonner";

import { router } from "./router";
import { queryClient } from "./query-client";
import { TooltipProvider } from "@/shared/ui/tooltip";

export function AgentEngineApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster position="bottom-right" richColors />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
