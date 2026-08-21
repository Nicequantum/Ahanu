import { IntelPanel } from "@/components/panels/IntelPanel";
import { KnowledgePanel } from "@/components/panels/KnowledgePanel";
import { LayersPanel } from "@/components/panels/LayersPanel";
import { LogPanel } from "@/components/panels/LogPanel";
import { PacksPanel } from "@/components/panels/PacksPanel";
import { PlanPanel } from "@/components/panels/PlanPanel";
import { SafetyPanel } from "@/components/panels/SafetyPanel";
import { SettingsPanel } from "@/components/panels/SettingsPanel";
import { SolunarPanel } from "@/components/panels/SolunarPanel";
import { SpeciesPanel } from "@/components/panels/SpeciesPanel";
import { WeatherPanel } from "@/components/panels/WeatherPanel";
import { pathLengthNm } from "@/lib/ahanu/geo";
import { COMMUNITY_HELM_LINE } from "@/lib/ahanu/packed-chart";
import type { PanelId } from "@/lib/ahanu/types";

export function PanelBody({ id }: { id: Exclude<PanelId, null> }) {
  switch (id) {
    case "layers":
      return <LayersPanel />;
    case "weather":
      return <WeatherPanel />;
    case "intel":
      return <IntelPanel />;
    case "log":
      return <LogPanel />;
    case "knowledge":
      return <KnowledgePanel />;
    case "plan":
      return <PlanPanel />;
    case "safety":
      return <SafetyPanel />;
    case "packs":
      return <PacksPanel />;
    case "species":
      return <SpeciesPanel />;
    case "solunar":
      return <SolunarPanel />;
    case "settings":
      return <SettingsPanel />;
    default:
      return null;
  }
}

export function CommunityStrip() {
  return <p className="mt-2 text-xs text-muted">{COMMUNITY_HELM_LINE}</p>;
}

export { pathLengthNm };
