import { Button } from "@/components/ui/button";
import {
  FLOAT_PLAN_AID_LINE,
  floatPlanBasename,
  formatFloatPlanHtml,
  formatFloatPlanText,
  snapshotFromState,
} from "@/lib/ahanu/float-plan";
import { useAhanu } from "@/lib/ahanu/store";
import { useMemo, useState } from "react";

function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function printHtml(html: string, filename: string) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (!w) {
    downloadText(filename, html, "text/html;charset=utf-8");
    URL.revokeObjectURL(url);
    return;
  }
  const revoke = () => URL.revokeObjectURL(url);
  w.addEventListener("load", () => {
    w.focus();
    w.print();
    window.setTimeout(revoke, 30_000);
  });
  window.setTimeout(revoke, 60_000);
}

export function FloatPlanExport() {
  const floatPlan = useAhanu((s) => s.floatPlan);
  const boatName = useAhanu((s) => s.boat.name);
  const contacts = useAhanu((s) => s.contacts);
  const packBbox = useAhanu((s) => s.packBbox);
  const packStart = useAhanu((s) => s.packStart);
  const packHours = useAhanu((s) => s.packHours);
  const packReady = useAhanu((s) => s.packReady);
  const sstStaleOverride = useAhanu((s) => s.sstStaleOverride);
  const clockMs = useAhanu((s) => s.clockMs);
  const [copied, setCopied] = useState(false);

  const snapshot = useMemo(
    () =>
      snapshotFromState({
        floatPlan,
        boatName,
        contacts,
        packBbox,
        packStart,
        packHours,
        packReady,
        sstStaleOverride,
        clockMs,
      }),
    [floatPlan, boatName, contacts, packBbox, packStart, packHours, packReady, sstStaleOverride, clockMs],
  );

  const text = useMemo(() => formatFloatPlanText(snapshot), [snapshot]);
  const html = useMemo(() => formatFloatPlanHtml(snapshot), [snapshot]);
  const base = floatPlanBasename(snapshot.vessel, snapshot.filedAt);

  return (
    <div>
      <h3 className="mb-1 text-sm font-medium">Leave ashore</h3>
      <p className="mb-2 text-[11px] text-muted">
        Copy or download a float plan from what is on this device. No network.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => downloadText(`${base}.txt`, text, "text/plain;charset=utf-8")}
        >
          Download .txt
        </Button>
        <Button variant="outline" size="sm" onClick={() => printHtml(html, `${base}.html`)}>
          Print
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted">{FLOAT_PLAN_AID_LINE}</p>
    </div>
  );
}
