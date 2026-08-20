import type { ComponentProps } from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-6 w-10 shrink-0 items-center rounded-full bg-elevated shadow-[0_0_0_1px_var(--color-line)] transition-colors data-[state=checked]:bg-sunrise",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-5 translate-x-0.5 rounded-full bg-foam transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-sunrise-fg" />
    </SwitchPrimitive.Root>
  );
}
