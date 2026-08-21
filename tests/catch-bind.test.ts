import "./register-alias.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { catchBindDecision, hashDeviceToken, requireDeviceAuth } = await import(
  "../cloudflare/src/ingest-auth.ts"
);
const workerMod = await import("../cloudflare/src/index.ts");
const worker = workerMod.default;

const START = "2026-08-20T21:40:00.000Z";

function catchBody(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    species: "bigeye",
    lat: 39.9,
    lon: -69.6,
    at: START,
    released: false,
    ...extra,
  };
}

function postCatch(id: string, token: string | null, extra: Record<string, unknown> = {}, env: Record<string, unknown> = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return worker.fetch(
    new Request("http://ahanu.test/api/catches", {
      method: "POST",
      headers,
      body: JSON.stringify(catchBody(id, extra)),
    }),
    { INGEST_TOKEN: "dock-ingest", ...env },
  );
}

type CatchRow = {
  id: string;
  user_id: string | null;
  species: string;
  lat: number;
  lon: number;
  at: string;
  length_in: number | null;
  weight_lb: number | null;
  released: number;
  notes: string | null;
  sst_c: number | null;
  depth_m: number | null;
  conditions: string | null;
  synced: number;
  device_hash: string | null;
};

class MemoryD1 {
  readonly rows = new Map<string, CatchRow>();

  seed(row: Partial<CatchRow> & { id: string }): void {
    this.rows.set(row.id, {
      id: row.id,
      user_id: row.user_id ?? null,
      species: row.species ?? "bigeye",
      lat: row.lat ?? 39.9,
      lon: row.lon ?? -69.6,
      at: row.at ?? START,
      length_in: row.length_in ?? null,
      weight_lb: row.weight_lb ?? null,
      released: row.released ?? 0,
      notes: row.notes ?? null,
      sst_c: row.sst_c ?? null,
      depth_m: row.depth_m ?? null,
      conditions: row.conditions ?? null,
      synced: row.synced ?? 1,
      device_hash: row.device_hash ?? null,
    });
  }

  prepare(sql: string) {
    const db = this;
    return {
      values: [] as unknown[],
      bind(...values: unknown[]) {
        this.values = values;
        return this;
      },
      async first<T>() {
        if (/SELECT\s+device_hash\s+FROM\s+catches/i.test(sql)) {
          const id = String(this.values[0] ?? "");
          const row = db.rows.get(id);
          return (row ? { device_hash: row.device_hash } : null) as T;
        }
        return null as T;
      },
      async run() {
        if (!/INSERT\s+INTO\s+catches/i.test(sql)) {
          return { meta: { changes: 0 } };
        }
        const [
          id,
          userId,
          species,
          lat,
          lon,
          at,
          lengthIn,
          weightLb,
          released,
          notes,
          sstC,
          depthM,
          conditions,
          deviceHash,
        ] = this.values as [
          string,
          string | null,
          string,
          number,
          number,
          string,
          number | null,
          number | null,
          number,
          string | null,
          number | null,
          number | null,
          string | null,
          string,
        ];
        const incoming: CatchRow = {
          id,
          user_id: userId,
          species,
          lat,
          lon,
          at,
          length_in: lengthIn,
          weight_lb: weightLb,
          released,
          notes,
          sst_c: sstC,
          depth_m: depthM,
          conditions,
          synced: 1,
          device_hash: deviceHash,
        };
        const have = db.rows.get(id);
        if (!have) {
          db.rows.set(id, incoming);
          return { meta: { changes: 1 } };
        }
        const bound = (have.device_hash ?? "").trim();
        if (bound && bound !== incoming.device_hash) {
          return { meta: { changes: 0 } };
        }
        db.rows.set(id, {
          ...incoming,
          device_hash: have.device_hash ?? incoming.device_hash,
        });
        return { meta: { changes: 1 } };
      },
    };
  }
}

describe("catch bind decision", () => {
  it("inserts, updates, binds unbound-once, and denies a foreign hash", async () => {
    const a = await hashDeviceToken("token-a");
    const b = await hashDeviceToken("token-b");
    assert.equal(a.length, 64);
    assert.notEqual(a, "token-a");
    assert.notEqual(a, b);
    assert.equal(catchBindDecision(null, a), "insert");
    assert.equal(catchBindDecision({ device_hash: a }, a), "update");
    assert.equal(catchBindDecision({ device_hash: null }, a), "bind");
    assert.equal(catchBindDecision({ device_hash: "" }, a), "bind");
    assert.equal(catchBindDecision({ device_hash: b }, a), "deny");
  });

  it("empty bearer is still 401 at the device gate", () => {
    const none = requireDeviceAuth(new Request("http://ahanu.test/api/catches", { method: "POST" }));
    assert.ok(none);
    assert.equal(none.status, 401);
  });
});

describe("POST /api/catches device bind", () => {
  it("token A creates, token A updates, token B same id is 403, no bearer is 401", async () => {
    const db = new MemoryD1();
    const env = { DB: db };

    const created = await postCatch("catch_bind_1", "token-A", { notes: "first" }, env);
    assert.equal(created.status, 201);
    const createdBody = (await created.json()) as { ok?: boolean; catch?: { id?: string; notes?: string } };
    assert.equal(createdBody.ok, true);
    assert.equal(createdBody.catch?.id, "catch_bind_1");
    const row = db.rows.get("catch_bind_1");
    assert.ok(row);
    assert.equal(row.notes, "first");
    assert.equal(row.device_hash, await hashDeviceToken("token-A"));
    assert.notEqual(row.device_hash, "token-A");

    const updated = await postCatch("catch_bind_1", "token-A", { notes: "skipper edit", species: "yellowfin" }, env);
    assert.equal(updated.status, 200);
    assert.equal(db.rows.get("catch_bind_1")?.notes, "skipper edit");
    assert.equal(db.rows.get("catch_bind_1")?.species, "yellowfin");
    assert.equal(db.rows.get("catch_bind_1")?.device_hash, await hashDeviceToken("token-A"));

    const foreign = await postCatch("catch_bind_1", "token-B", { notes: "stolen", species: "mahi" }, env);
    assert.equal(foreign.status, 403);
    const foreignBody = (await foreign.json()) as { error?: string };
    assert.equal(foreignBody.error, "catch belongs to another device");
    assert.equal(db.rows.get("catch_bind_1")?.notes, "skipper edit");
    assert.equal(db.rows.get("catch_bind_1")?.species, "yellowfin");

    const other = await postCatch("catch_bind_2", "token-B", { notes: "own" }, env);
    assert.equal(other.status, 201);
    assert.equal(db.rows.get("catch_bind_2")?.device_hash, await hashDeviceToken("token-B"));

    const none = await postCatch("catch_bind_1", null, {}, env);
    assert.equal(none.status, 401);
  });

  it("GET /api/catches stays 404 — no list of other devices", async () => {
    const db = new MemoryD1();
    const none = await worker.fetch(new Request("http://ahanu.test/api/catches"), { DB: db });
    assert.equal(none.status, 404);
    const withTok = await worker.fetch(
      new Request("http://ahanu.test/api/catches", { headers: { Authorization: "Bearer token-A" } }),
      { DB: db },
    );
    assert.equal(withTok.status, 404);
  });

  it("existing unbound row binds on the first successful same-id write", async () => {
    const db = new MemoryD1();
    db.seed({ id: "catch_legacy", notes: "probe", device_hash: null });
    const env = { DB: db };

    const first = await postCatch("catch_legacy", "first-writer", { notes: "claimed" }, env);
    assert.equal(first.status, 200);
    assert.equal(db.rows.get("catch_legacy")?.device_hash, await hashDeviceToken("first-writer"));
    assert.equal(db.rows.get("catch_legacy")?.notes, "claimed");

    const later = await postCatch("catch_legacy", "other-device", { notes: "nope" }, env);
    assert.equal(later.status, 403);
    assert.equal(db.rows.get("catch_legacy")?.notes, "claimed");
  });
});
