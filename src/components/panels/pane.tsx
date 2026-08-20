import { ScrollArea } from "@/components/ui/scroll-area";
import type { ReactNode } from "react";

export function Pane({ title, kicker, children }: { title: string; kicker?: string; children: ReactNode }) {
  return (
    <ScrollArea className="h-full px-4 py-4">
      <p className="text-[10px] tracking-[0.22em] text-sunrise uppercase">{kicker ?? "Ahanu"}</p>
      <h2 className="font-display mb-4 text-2xl text-foam">{title}</h2>
      {children}
    </ScrollArea>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-elevated px-3 py-2">
      <p className="text-[10px] tracking-widest text-faint uppercase">{label}</p>
      <p className="text-sm tabular text-foam">{value}</p>
    </div>
  );
}
