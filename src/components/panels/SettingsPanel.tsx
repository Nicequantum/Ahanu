import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { DISPLAY_MODES } from "@/lib/ahanu/constants";
import { metersToFathoms } from "@/lib/ahanu/geo";
import { useAhanu } from "@/lib/ahanu/store";
import { Input } from "@/components/ui/input";
import { GARMIN_SIGNAL_VHF_PORT } from "@/lib/sensors/ports";
import type { NavMode, RadioMode } from "@/lib/ahanu/types";
import { Pane, Stat } from "@/components/panels/pane";

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

const RADIOS: { id: RadioMode; label: string }[] = [
  { id: "sim", label: "Simulated" },
  { id: "ws", label: "WebSocket" },
  { id: "tcp", label: "Signal TCP" },
  { id: "udp", label: "UDP JSON" },
];

function RadioBlock() {
  const mode = useAhanu((s) => s.radioMode);
  const setMode = useAhanu((s) => s.setRadioMode);
  const fallback = useAhanu((s) => s.radioSimFallback);
  const setFallback = useAhanu((s) => s.setRadioSimFallback);
  const ws = useAhanu((s) => s.radioWsUrl);
  const setWs = useAhanu((s) => s.setRadioWsUrl);
  const host = useAhanu((s) => s.radioHost);
  const setHost = useAhanu((s) => s.setRadioHost);
  const note = useAhanu((s) => s.sensorNote);
  return (
    <div className="mt-4">
      <p className="mb-2 text-[11px] tracking-widest text-faint uppercase">AIS radio · receive only</p>
      <div className="mb-3 flex flex-wrap gap-2">
        {RADIOS.map((m) => (
          <Button key={m.id} size="sm" variant={mode === m.id ? "default" : "outline"} onClick={() => setMode(m.id)}>
            {m.label}
          </Button>
        ))}
      </div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-sm">Simulated contacts if the radio is quiet</span>
        <Switch checked={fallback} onCheckedChange={setFallback} />
      </div>
      <label className="mb-2 block text-xs text-muted" htmlFor="ais-ws">
        WebSocket JSON gateway
      </label>
      <Input
        id="ais-ws"
        value={ws}
        placeholder="ws://192.168.1.20:39151"
        onChange={(e) => setWs(e.target.value)}
        className="mb-2"
      />
      <label className="mb-2 block text-xs text-muted" htmlFor="ais-host">
        Garmin Signal host · TCP {GARMIN_SIGNAL_VHF_PORT}
      </label>
      <Input
        id="ais-host"
        value={host}
        placeholder="192.168.1.50"
        onChange={(e) => setHost(e.target.value)}
        className="mb-2"
      />
      <p className="text-xs text-muted">{note}</p>
      <p className="mt-1 text-xs text-faint">
        This page does not transmit. A browser cannot open raw TCP or UDP — those clients run on the boat computer.
      </p>
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
    <Pane title="Bridge" kicker="Display · nav">
      <p className="mb-2 text-[11px] tracking-widest text-faint uppercase">Night modes</p>
      <div className="mb-4 grid grid-cols-2 gap-2">
        {DISPLAY_MODES.map((m) => (
          <Button key={m.id} variant={mode === m.id ? "default" : "outline"} onClick={() => setMode(m.id)}>
            {m.label}
          </Button>
        ))}
      </div>
      <p className="mb-2 text-[11px] tracking-widest text-faint uppercase">Own-ship</p>
      <div className="mb-3 flex flex-wrap gap-2">
        {NAV_MODES.map((m) => (
          <Button key={m.id} size="sm" variant={nav === m.id ? "default" : "outline"} onClick={() => setNav(m.id)}>
            {m.label}
          </Button>
        ))}
      </div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm">Follow vessel</span>
        <Switch checked={follow} onCheckedChange={setFollow} />
      </div>
      <NmeaToggle />
      <RadioBlock />
      <Button variant="outline" className="w-full" onClick={anchored ? weigh : drop}>
        {anchored ? "Weigh anchor" : "Drop anchor alarm"}
      </Button>
      <p className="mt-4 mb-2 text-[11px] tracking-widest text-faint uppercase">Safety depth</p>
      <div className="mb-2 grid grid-cols-2 gap-2">
        <Stat label="Under keel" value={`${depthM.toFixed(0)} m`} />
        <Stat label="Alarm" value={`${safetyDepth.toFixed(0)} m · ${metersToFathoms(safetyDepth).toFixed(1)} fm`} />
      </div>
      <Slider
        className="my-2"
        min={3}
        max={40}
        step={1}
        value={[safetyDepth]}
        onValueChange={([n]) => setSafetyDepth(n ?? 10)}
      />
      <Badge tone={shallow ? "nogo" : "go"}>{shallow ? "Shallower than alarm" : "Clear of alarm"}</Badge>
      <p className="mt-4 text-xs text-muted">
        {boat.name} · cruise {boat.cruiseKt} kt · troll {boat.trollKt} kt. Charts are an aid, not a substitute for
        lookout and official ENC.
      </p>
    </Pane>
  );
}
