import { Progress as ProgressPrimitive } from "@base-ui/react/progress"
import { cn } from "@/lib/utils"

function Progress({
  value = 0,
  className,
  indicatorClassName,
  ...props
}: ProgressPrimitive.Root.Props & {
  indicatorClassName?: string;
}) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn("relative", className)}
      {...props}
    >
      <ProgressPrimitive.Track
        data-slot="progress-track"
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          className={cn(
            "h-full rounded-full bg-primary transition-all duration-500",
            indicatorClassName,
          )}
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  )
}

export { Progress }
