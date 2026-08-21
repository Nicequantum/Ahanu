import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { DISPLAY_MODES } from "@/lib/ahanu/constants";
import {
  clearDeviceToken,
  deviceToken,
  deviceTokenStatus,
  lastRetryUnsyncedStatus,
  retryUnsyncedStatus,
  saveDeviceToken,
} from "@/lib/ahanu/catch-sync";
import { metersToFathoms } from "@/lib/ahanu/geo";
import { useAhanu } from "@/lib/ahanu/store";
import type { NavMode } from "@/lib/ahanu/types";
import { Pane, Stat } from "@/components/panels/pane";
import { useState } from "react";

function NmeaToggle() {
  const on = useAhanu((s) => s.nmeaGateway);
  const set = useAhanu((s) => s.setNmeaGateway);
  return (
    <div className="mb-3 flex items-center justify-between">
      <span className="text-sm">NMEA Wi-Fi gateway</span>
      <Switch checked={on} onCheckedChange={set} />
    </div>
  );
}

function DeviceTokenControl() {
  const [draft, setDraft] = useState(() => deviceToken() ?? "");
  const [status, setStatus] = useState<string>(
    () => lastRetryUnsyncedStatus() ?? deviceTokenStatus(),
  );

  function onSave() {
    const next = saveDeviceToken(draft);
    setDraft(next);
    setStatus(deviceTokenStatus());
    void useAhanu
      .getState()
      .retryUnsyncedCatches()
      .then((result) => {
        setStatus(retryUnsyncedStatus(result));
      });
  }

  function onClear() {
    clearDeviceToken();
    setDraft("");
    setStatus(deviceTokenStatus());
  }

  return (
    <div className="mt-4">
      <p className="mb-2 text-[11px] tracking-widest text-faint uppercase">Catch sync</p>
      <p className="mb-2 text-xs text-muted">
        Token the helm sends with a catch. Empty stays on this device.
      </p>
      <label className="mb-2 block space-y-1">
        <span className="text-[11px] text-muted">Device token</span>
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Leave blank to issue one"
        />
      </label>
      <div className="mb-2 flex gap-2">
        <Button type="button" size="sm" onClick={onSave}>
          Save
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onClear}>
          Clear
        </Button>
      </div>
      <p className="text-xs text-muted">{status}</p>
    </div>
  );
}

const NAV_MODES: { id: NavMode; label: string }[] = [
  { id: "trolling", label: "Trolling" },
  { id: "steaming", label: "Steaming" },
  { id: "gps", label: "GPS" },
  { id: "anchor", label: "Anchor" },
];

export function SettingsPanel() {
  const mode = useAhanu((s) => s.displayMode);
  const setMode = useAhanu((s) => s.setDisplayMode);
  const boat = useAhanu((s) => s.boat);
  const nav = useAhanu((s) => s.vessel.mode);
  const setNav = useAhanu((s) => s.setMode);
  const follow = useAhanu((s) => s.followShip);
  const setFollow = useAhanu((s) => s.setFollow);
  const drop = useAhanu((s) => s.dropAnchor);
  const weigh = useAhanu((s) => s.weighAnchor);
  const anchored = useAhanu((s) => s.vessel.anchored);
  const depthM = useAhanu((s) => s.vessel.depthM);
  const safetyDepth = useAhanu((s) => s.safetyDepthM);
  const setSafetyDepth = useAhanu((s) => s.setSafetyDepth);
  const shallow = depthM < safetyDepth;

  return (
    <Pane title="Bridge" kicker="Display · nav · sync">
      <p className="mb-2 text-[11px] tracking-widest text-faint uppercase">Night modes</p>
      <div className="mb-4 grid grid-cols-2 gap-2">
        {DISPLAY_MODES.map((m) => (
          <Button
            key={m.id}
            variant={mode === m.id ? "default" : "outline"}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </Button>
        ))}
      </div>
      <p className="mb-4 text-xs text-muted">Last helm is kept on this device.</p>
      <p className="mb-2 text-[11px] tracking-widest text-faint uppercase">Own-ship</p>
      <div className="mb-3 flex flex-wrap gap-2">
        {NAV_MODES.map((m) => (
          <Button
            key={m.id}
            size="sm"
            variant={nav === m.id ? "default" : "outline"}
            onClick={() => setNav(m.id)}
          >
            {m.label}
          </Button>
        ))}
      </div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm">Follow vessel</span>
        <Switch checked={follow} onCheckedChange={setFollow} />
      </div>
      <p className="mb-3 text-[11px] text-muted">Pan or zoom drops Follow. Last Follow is kept on this device. Tap Follow to center on the vessel.</p>
      <NmeaToggle />
      <Button variant="outline" className="w-full" onClick={anchored ? weigh : drop}>
        {anchored ? "Weigh anchor" : "Drop anchor alarm"}
      </Button>
      <p className="mt-4 mb-2 text-[11px] tracking-widest text-faint uppercase">Safety depth</p>
      <div className="mb-2 grid grid-cols-2 gap-2">
        <Stat label="Under keel" value={`${depthM.toFixed(0)} m`} />
        <Stat
          label="Alarm"
          value={`${safetyDepth.toFixed(0)} m · ${metersToFathoms(safetyDepth).toFixed(1)} fm`}
        />
      </div>
      <Slider
        className="my-2"
        min={3}
        max={40}
        step={1}
        value={[safetyDepth]}
        onValueChange={([n]) => setSafetyDepth(n ?? 10)}
      />
      <Badge tone={shallow ? "nogo" : "go"}>
        {shallow ? "Shallower than alarm" : "Clear of alarm"}
      </Badge>
      <DeviceTokenControl />
      <p className="mt-4 text-xs text-muted">
        {boat.name} · cruise {boat.cruiseKt} kt · troll {boat.trollKt} kt. Charts are an aid, not a
        substitute for lookout and official ENC.
      </p>
    </Pane>
  );
}
