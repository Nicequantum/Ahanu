import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  tone = "muted",
  children,
}: {
  className?: string;
  tone?: "muted" | "sunrise" | "lagoon" | "go" | "caution" | "nogo";
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    muted: "bg-elevated text-muted",
    sunrise: "bg-sunrise/15 text-sunrise",
    lagoon: "bg-lagoon/15 text-lagoon",
    go: "bg-go/15 text-go",
    caution: "bg-caution/15 text-caution",
    nogo: "bg-nogo/15 text-nogo",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium tracking-wide",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
