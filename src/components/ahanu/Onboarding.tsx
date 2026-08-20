import { Button } from "@/components/ui/button";
import { Anchor, Compass, Fish } from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";

const STORAGE_KEY = "ahanu-briefed-v1";

const BULLETS: { icon: ComponentType<{ className?: string }>; text: string }[] = [
  {
    icon: Anchor,
    text: "Download packs at the dock, over marina Wi-Fi. Steam with no cell.",
  },
  {
    icon: Compass,
    text: "Charts are an aid, not ENC. Keep a lookout and a legal chart.",
  },
  {
    icon: Fish,
    text: "Mark fish on the gold button. SST, depth, and time go in the log.",
  },
];

function readBriefed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeBriefed() {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* private mode — still dismiss for this session */
  }
}

export function Onboarding() {
  const [ready, setReady] = useState(false);
  const [briefed, setBriefed] = useState(true);

  useEffect(() => {
    setBriefed(readBriefed());
    setReady(true);
  }, []);

  if (!ready || briefed) return null;

  return (
    <div className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-abyss/45 p-4">
      <div className="glass w-full max-w-md rounded-2xl px-6 py-6">
        <p className="text-[10px] tracking-[0.22em] text-sunrise uppercase">First run</p>
        <h2 className="font-display mt-1 text-2xl leading-tight text-foam">
          Ahanu — ah-HAH-noo — He Laughs
        </h2>
        <ul className="mt-5 space-y-3">
          {BULLETS.map((b) => (
            <li key={b.text} className="flex items-start gap-3">
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-elevated text-sunrise">
                <b.icon className="size-4" />
              </span>
              <p className="text-sm leading-relaxed text-muted">{b.text}</p>
            </li>
          ))}
        </ul>
        <Button
          className="mt-6 w-full"
          onClick={() => {
            writeBriefed();
            setBriefed(true);
          }}
        >
          Take the helm
        </Button>
      </div>
    </div>
  );
}
