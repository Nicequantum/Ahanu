import type { EngineId } from "@/lib/ahanu/types";

export type InstanceMap = Record<string, "port" | "starboard">;

/** Instance 0 is not port. An unknown id stays unmapped. */
export function resolveEngineId(instance: number, map: InstanceMap): EngineId {
  const side = map[String(instance)];
  if (side === "port" || side === "starboard") return side;
  return "unmapped";
}

/** One bank per side. Assigning port clears the previous port instance. */
export function assignInstance(map: InstanceMap, instance: number, side: "port" | "starboard"): InstanceMap {
  const next: InstanceMap = {};
  for (const [key, value] of Object.entries(map)) {
    if (value !== side && key !== String(instance)) next[key] = value;
  }
  next[String(instance)] = side;
  return next;
}

export function clearInstance(map: InstanceMap, instance: number): InstanceMap {
  const next = { ...map };
  delete next[String(instance)];
  return next;
}
