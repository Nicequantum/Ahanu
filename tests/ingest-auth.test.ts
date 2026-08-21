import "./register-alias.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  bearerToken,
  ingestSecret,
  requireDeviceAuth,
  requireIngestAuth,
  timingSafeEqual,
} = await import("../cloudflare/src/ingest-auth.ts");

const worker = (await import("../cloudflare/src/index.ts")).default;

const START = "2026-08-20T21:40:00.000Z";
const CATCH_BODY = {
  id: "catch_auth_1",
  species: "bigeye",
  lat: 39.9,
  lon: -69.6,
  at: START,
  released: false,
};

function req(path: string, init: RequestInit = {}): Request {
  return new Request(`http://ahanu.test${path}`, init);
}

async function denial(res: Response | null): Promise<{ status: number; error?: string; hint?: string }> {
  assert.ok(res);
  const body = (await res.json()) as { error?: string; hint?: string };
  return { status: res.status, ...body };
}

describe("ingest token fail-closed", () => {
  it("empty or missing INGEST_TOKEN denies even with a bearer", async () => {
    const withBearer = req("/api/ingest", {
      method: "POST",
      headers: { Authorization: "Bearer anyone" },
    });
    const missing = await denial(requireIngestAuth(withBearer, {}));
    assert.equal(missing.status, 401);
    assert.equal(missing.hint, "INGEST_TOKEN is not configured");

    const blank = await denial(requireIngestAuth(withBearer, { INGEST_TOKEN: "   " }));
    assert.equal(blank.status, 401);
    assert.equal(blank.hint, "INGEST_TOKEN is not configured");
  });

  it("wrong token and missing bearer are 401", async () => {
    const env = { INGEST_TOKEN: "dock-ingest" };
    const none = await denial(requireIngestAuth(req("/api/ingest", { method: "POST" }), env));
    assert.equal(none.status, 401);
    assert.equal(none.hint, "Authorization: Bearer <INGEST_TOKEN>");

    const empty = await denial(
      requireIngestAuth(req("/api/ingest", { method: "POST", headers: { Authorization: "Bearer   " } }), env),
    );
    assert.equal(empty.status, 401);

    const wrong = await denial(
      requireIngestAuth(
        req("/api/ingest", { method: "POST", headers: { Authorization: "Bearer device-token" } }),
        env,
      ),
    );
    assert.equal(wrong.status, 401);
    assert.equal(wrong.hint, "ingest token mismatch");
  });

  it("matching INGEST_TOKEN or AHANU_INGEST_TOKEN alias passes", () => {
    const secret = "dock-ingest";
    const ok = req("/api/ingest", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    });
    assert.equal(requireIngestAuth(ok, { INGEST_TOKEN: secret }), null);
    assert.equal(requireIngestAuth(ok, { AHANU_INGEST_TOKEN: secret }), null);
    assert.equal(ingestSecret({ INGEST_TOKEN: ` ${secret} ` }), secret);
  });

  it("timingSafeEqual rejects length and content mismatches", () => {
    assert.equal(timingSafeEqual("abc", "abc"), true);
    assert.equal(timingSafeEqual("abc", "abd"), false);
    assert.equal(timingSafeEqual("abc", "ab"), false);
    assert.equal(bearerToken(req("/", { headers: { Authorization: "Bearer  tok  " } })), "tok");
    assert.equal(bearerToken(req("/")), null);
  });
});

describe("catch device-token stays independent of ingest secret", () => {
  it("any non-empty device bearer is enough; ingest secret is not required", () => {
    assert.ok(requireDeviceAuth(req("/api/catches", { method: "POST" })));
    assert.equal(
      requireDeviceAuth(req("/api/catches", { method: "POST", headers: { Authorization: "Bearer skipper-device" } })),
      null,
    );
  });
});

describe("Worker HTTP wiring", () => {
  it("POST /api/ingest without token or with a device token is 401", async () => {
    const env = { INGEST_TOKEN: "dock-ingest" };
    const none = await worker.fetch(req("/api/ingest?hours=999", { method: "POST" }), env);
    assert.equal(none.status, 401);

    const device = await worker.fetch(
      req("/api/ingest?hours=999", { method: "POST", headers: { Authorization: "Bearer skipper-device" } }),
      env,
    );
    assert.equal(device.status, 401);
    const body = (await device.json()) as { hint?: string };
    assert.equal(body.hint, "ingest token mismatch");
  });

  it("POST /api/ingest with missing secret fails closed", async () => {
    const res = await worker.fetch(
      req("/api/ingest?hours=999", { method: "POST", headers: { Authorization: "Bearer anyone" } }),
      {},
    );
    assert.equal(res.status, 401);
    const body = (await res.json()) as { hint?: string };
    assert.equal(body.hint, "INGEST_TOKEN is not configured");
  });

  it("POST /api/ingest with the ingest token reaches body validation, not an open stub", async () => {
    const res = await worker.fetch(
      req("/api/ingest?hours=999", { method: "POST", headers: { Authorization: "Bearer dock-ingest" } }),
      { INGEST_TOKEN: "dock-ingest" },
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: string };
    assert.equal(body.error, "hours must be 1–168");
  });

  it("POST /api/catches still accepts a device token when INGEST_TOKEN is set", async () => {
    const res = await worker.fetch(
      req("/api/catches", {
        method: "POST",
        headers: { Authorization: "Bearer skipper-device", "Content-Type": "application/json" },
        body: JSON.stringify(CATCH_BODY),
      }),
      { INGEST_TOKEN: "dock-ingest" },
    );
    assert.equal(res.status, 201);
    const body = (await res.json()) as { ok?: boolean; catch?: { id?: string } };
    assert.equal(body.ok, true);
    assert.equal(body.catch?.id, CATCH_BODY.id);
  });

  it("POST /api/catches without bearer is still 401", async () => {
    const res = await worker.fetch(
      req("/api/catches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(CATCH_BODY),
      }),
      { INGEST_TOKEN: "dock-ingest" },
    );
    assert.equal(res.status, 401);
  });
});

describe("community HTTP is closed", () => {
  it("GET /api/community is 404 — unused surface, not a public feed", async () => {
    const res = await worker.fetch(req("/api/community"), { INGEST_TOKEN: "dock-ingest" });
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error?: string; hint?: string };
    assert.equal(body.error, "not found");
    assert.match(body.hint ?? "", /unused/i);
  });

  it("POST /api/community is 404 — no open write", async () => {
    const res = await worker.fetch(
      req("/api/community", {
        method: "POST",
        headers: { Authorization: "Bearer anyone", "Content-Type": "application/json" },
        body: JSON.stringify({ id: "rpt-open", who: "x", species: "bigeye", lat: 39.9, lon: -69.6, at: START, note: "no" }),
      }),
      { INGEST_TOKEN: "dock-ingest" },
    );
    assert.equal(res.status, 404);
  });
});

describe("catch list is not a public read of other devices", () => {
  it("GET /api/catches is 404 with or without a bearer", async () => {
    const none = await worker.fetch(req("/api/catches"), { INGEST_TOKEN: "dock-ingest" });
    assert.equal(none.status, 404);

    const withTok = await worker.fetch(
      req("/api/catches", { headers: { Authorization: "Bearer skipper-device" } }),
      { INGEST_TOKEN: "dock-ingest" },
    );
    assert.equal(withTok.status, 404);
    const body = (await withTok.json()) as { hint?: string };
    assert.match(body.hint ?? "", /device-local/i);
  });

  it("GET /api/packs without bearer is not 401", async () => {
    const res = await worker.fetch(req("/api/packs?hours=999"), { INGEST_TOKEN: "dock-ingest" });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: string };
    assert.equal(body.error, "hours must be 1–168");
  });
});
