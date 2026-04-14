import * as React from "react";
import { Button, buttonVariants } from "@/shared/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/shared/ui/tooltip";
import type { VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

type IconButtonSize = "xs" | "sm" | "default" | "lg";

const sizeMap: Record<IconButtonSize, VariantProps<typeof buttonVariants>["size"]> = {
  xs: "icon-xs",
  sm: "icon-sm",
  default: "icon",
  lg: "icon-lg",
};

interface IconButtonProps
  extends Omit<React.ComponentProps<typeof Button>, "size"> {
  /** Accessible label shown as tooltip and screen-reader text */
  label: string;
  size?: IconButtonSize;
}

function IconButton({
  label,
  size = "default",
  className,
  ...props
}: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size={sizeMap[size]}
            aria-label={label}
            className={cn("rounded-full", className)}
            {...props}
          />
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export { IconButton };
export type { IconButtonProps };
