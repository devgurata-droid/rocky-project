import { useEffect, useRef, useState } from "react";
import { Palette } from "lucide-react";
import { IconButton } from "@/shared/ui/icon-button";
import { cn } from "@/shared/lib/utils";

const PRESET_COLORS = [
  null,
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
];

const FAN_RADIUS = 32;
const START_ANGLE = 180;
const END_ANGLE = 360;

export function AgentColorFan({
  currentColor,
  onSelect,
  disabled,
  groupHovered,
  onOpenChange,
}: {
  currentColor: string | null;
  onSelect: (color: string | null) => void;
  disabled?: boolean;
  groupHovered: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  function updateOpen(next: boolean) {
    setOpen(next);
    onOpenChange?.(next);
  }

  // 카드 hover가 풀리고 팔레트도 열려있지 않으면 닫기
  useEffect(() => {
    if (!groupHovered && open) {
      // 약간의 딜레이: 마우스가 색상 dot 위로 갈 수 있음
      const timer = setTimeout(() => {
        if (!containerRef.current?.matches(":hover")) {
          updateOpen(false);
        }
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [groupHovered]);

  // 외부 클릭 시 닫기
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        updateOpen(false);
      }
    }
    document.addEventListener("pointerdown", handleClick);
    return () => document.removeEventListener("pointerdown", handleClick);
  }, [open]);

  function handleToggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    updateOpen(!open);
  }

  function handleSelect(color: string | null, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onSelect(color);
    updateOpen(false);
  }

  const totalItems = PRESET_COLORS.length;
  const angleStep = (END_ANGLE - START_ANGLE) / (totalItems - 1);

  return (
    <div className="relative" ref={containerRef}>
      <IconButton
        variant="ghost"
        size="sm"
        label="색상 변경"
        onClick={handleToggle}
        disabled={disabled}
      >
        <Palette size={16} />
      </IconButton>

      {PRESET_COLORS.map((color, i) => {
        const angle = (START_ANGLE + angleStep * i) * (Math.PI / 180);
        const x = Math.cos(angle) * FAN_RADIUS;
        const y = Math.sin(angle) * FAN_RADIUS;

        return (
          <button
            key={color ?? "none"}
            type="button"
            onClick={(e) => handleSelect(color, e)}
            className={cn(
              "absolute top-1/2 left-1/2 size-5 rounded-full border shadow-sm transition-all duration-300",
              open
                ? "scale-100 opacity-100"
                : "pointer-events-none scale-0 opacity-0",
              color && color === currentColor && "ring-2 ring-offset-1",
              !color && "border-dashed border-muted-foreground/40 bg-background",
            )}
            style={{
              ...(color ? { backgroundColor: color, borderColor: color } : {}),
              ...(color && color === currentColor ? { "--tw-ring-color": `${color}80` } as React.CSSProperties : {}),
              transform: open
                ? `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`
                : "translate(-50%, -50%) scale(0)",
              transitionDelay: open ? `${i * 30}ms` : "0ms",
              zIndex: 50,
            }}
          />
        );
      })}
    </div>
  );
}
