import type { CatchRecord } from "./types";
import { packsApiBase } from "./pack-client";

/**
 * POST a catch to the data plane. Never throws to the helm.
 * 401 / network / 5xx → synced: false. The log stays on the boat.
 */
export async function syncCatch(
  rec: CatchRecord,
  opts?: { token?: string; base?: string },
): Promise<CatchRecord> {
  const base = opts?.base ?? packsApiBase();
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts?.token) headers.Authorization = `Bearer ${opts.token}`;
    const res = await fetch(`${base}/api/catches`, {
      method: "POST",
      headers,
      body: JSON.stringify(rec),
    });
    if (!res.ok) return { ...rec, synced: false };
    const payload = (await res.json()) as { catch?: { synced?: boolean } };
    return { ...rec, synced: payload.catch?.synced === true };
  } catch {
    return { ...rec, synced: false };
  }
}

export function deviceToken(): string | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const t = localStorage.getItem("ahanu-device-token");
    return t && t.trim() ? t.trim() : undefined;
  } catch {
    return undefined;
  }
}
