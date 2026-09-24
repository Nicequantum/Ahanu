export function DeltaChip({
  label,
  text,
  hot,
}: {
  label: string;
  text: string;
  hot: boolean;
}) {
  return (
    <div
      className="rounded-md px-2 py-1"
      style={{
        background: "var(--er-face)",
        boxShadow: hot ? "inset 0 0 0 1px var(--er-hot)" : "inset 0 0 0 1px var(--er-tick)",
      }}
    >
      <p className="text-[10px] tracking-[0.14em] uppercase" style={{ color: "var(--er-muted)" }}>{label}</p>
      <p className="text-sm tabular-nums" style={{ color: hot ? "var(--er-hot)" : "var(--er-ink)" }}>{text}</p>
    </div>
  );
}
