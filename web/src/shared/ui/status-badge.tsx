import { Badge } from "@/shared/ui/badge";
import { cn } from "@/lib/utils";

type StatusBadgeVariant = "active" | "archived" | "neutral";

const variantStyles: Record<StatusBadgeVariant, string> = {
  active: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  archived: "bg-muted text-muted-foreground",
  neutral: "bg-secondary text-secondary-foreground",
};

const variantLabels: Record<StatusBadgeVariant, string> = {
  active: "활성",
  archived: "보관됨",
  neutral: "",
};

interface StatusBadgeProps {
  variant: StatusBadgeVariant;
  /** Override the default label */
  label?: string;
  className?: string;
}

function StatusBadge({ variant, label, className }: StatusBadgeProps) {
  return (
    <Badge
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        variantStyles[variant],
        className,
      )}
    >
      {label ?? variantLabels[variant]}
    </Badge>
  );
}

export { StatusBadge };
export type { StatusBadgeProps, StatusBadgeVariant };
