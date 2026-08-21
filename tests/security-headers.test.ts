import "./register-alias.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  AUTH_ISSUER_ORIGIN,
  HELM_APEX_ORIGIN,
  HELM_WORKERS_ORIGIN,
  HELM_WWW_ORIGIN,
  PACKS_CUSTOM_ORIGIN,
  PACKS_WORKER_ORIGIN,
  applyPacksSecurityHeaders,
  applyPwaSecurityHeaders,
  isCustomAhanuHost,
  isHelmOrigin,
  isProductionHelmHost,
  packsSecurityHeaders,
  pwaContentSecurityPolicy,
  pwaSecurityHeaders,
} = await import("../src/lib/ahanu/security-headers.ts");
const {
  isPwaHealthMethod,
  isPwaHealthPath,
  pwaHealthResponse,
} = await import("../src/lib/ahanu/pwa-health.ts");
const { handlePacksRequest } = await import("../src/lib/ahanu/pack-http.ts");
const worker = (await import("../cloudflare/src/index.ts")).default;

const NDBC = `#STN LAT LON YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES PTDY ATMP WTMP DEWP VIS TIDE
44097 40.967 -71.126 26 08 20 16 40 210 5.2 6.8 1.0 8 5.4 200 1016.5 +0.0 22.1 21.8 MM MM MM
`;

function healthEnv() {
  return {
    SERVICE: "ahanu-packs",
    fetchImpl: async (url: string) => {
      if (url.includes("latest_obs")) return new Response(NDBC, { status: 200 });
      return new Response("no", { status: 404 });
    },
  };
}

describe("helm / packs origin helpers", () => {
  it("allowlists production helm, not arbitrary origins", () => {
    assert.equal(isHelmOrigin(HELM_APEX_ORIGIN), true);
    assert.equal(isHelmOrigin(HELM_WWW_ORIGIN), true);
    assert.equal(isHelmOrigin(HELM_WORKERS_ORIGIN), true);
    assert.equal(isHelmOrigin("https://preview.ahanu.hombre3536.workers.dev"), true);
    assert.equal(isHelmOrigin("https://ahanu-abc.hombre3536.workers.dev"), false);
    assert.equal(isHelmOrigin("https://evil.example"), false);
    assert.equal(isHelmOrigin("https://ahanu-packs.hombre3536.workers.dev"), false);
    assert.equal(isHelmOrigin("http://ahanu.dev"), false);
    assert.equal(isHelmOrigin(null), false);
    assert.equal(isCustomAhanuHost("ahanu.dev"), true);
    assert.equal(isCustomAhanuHost("api.ahanu.dev"), true);
    assert.equal(isCustomAhanuHost("ahanu.hombre3536.workers.dev"), false);
    assert.equal(isProductionHelmHost("ahanu.hombre3536.workers.dev"), true);
  });
});

describe("PWA security headers", () => {
  it("CSP keeps MapLibre worker + packs + SW, and denies framing on prod hosts", () => {
    const csp = pwaContentSecurityPolicy();
    assert.match(csp, /worker-src 'self' blob:/);
    assert.match(csp, /child-src 'self' blob:/);
    assert.match(csp, new RegExp(PACKS_CUSTOM_ORIGIN.replace(/\./g, "\\.")));
    assert.match(csp, new RegExp(PACKS_WORKER_ORIGIN.replace(/\./g, "\\.")));
    assert.match(csp, /connect-src 'self'/);
    assert.match(csp, /img-src 'self' data: blob:/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, new RegExp(AUTH_ISSUER_ORIGIN.replace(/\./g, "\\.")));
    assert.equal(csp.includes("'unsafe-eval'"), false);

    const prod = pwaSecurityHeaders(
      new Request("https://ahanu.dev/", { headers: { host: "ahanu.dev" } }),
    );
    assert.equal(prod["X-Content-Type-Options"], "nosniff");
    assert.equal(prod["X-Frame-Options"], "DENY");
    assert.equal(prod["Referrer-Policy"], "strict-origin-when-cross-origin");
    assert.ok(prod["Strict-Transport-Security"]?.includes("max-age=31536000"));
    assert.match(prod["Content-Security-Policy"] ?? "", /worker-src 'self' blob:/);
    assert.equal(prod["Cross-Origin-Opener-Policy"], "same-origin-allow-popups");

    const workers = pwaSecurityHeaders(
      new Request("https://ahanu.hombre3536.workers.dev/", {
        headers: { host: "ahanu.hombre3536.workers.dev" },
      }),
    );
    assert.equal(workers["X-Frame-Options"], "DENY");
    assert.equal(workers["Strict-Transport-Security"], undefined);

    const preview = pwaSecurityHeaders(
      new Request("https://guest.grok-sandbox.com/", {
        headers: { host: "guest.grok-sandbox.com" },
      }),
    );
    assert.equal(preview["X-Frame-Options"], undefined);
    assert.equal(preview["Strict-Transport-Security"], undefined);
    assert.equal((preview["Content-Security-Policy"] ?? "").includes("frame-ancestors"), false);
  });

  it("applyPwaSecurityHeaders does not drop existing response headers", () => {
    const inner = new Response("<html></html>", {
      headers: { "content-type": "text/html; charset=utf-8", "set-cookie": "a=1; Path=/" },
    });
    const out = applyPwaSecurityHeaders(
      new Request("https://ahanu.dev/", { headers: { host: "ahanu.dev" } }),
      inner,
    );
    assert.equal(out.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(out.headers.get("X-Content-Type-Options"), "nosniff");
    assert.ok(out.headers.get("set-cookie")?.includes("a=1"));
  });
});

describe("PWA /health", () => {
  it("matches only GET/HEAD /health, not the SPA catch-all", () => {
    assert.equal(isPwaHealthPath("/health"), true);
    assert.equal(isPwaHealthPath("/health/"), true);
    assert.equal(isPwaHealthPath("/"), false);
    assert.equal(isPwaHealthPath("/login"), false);
    assert.equal(isPwaHealthPath("/healthz"), false);
    assert.equal(isPwaHealthMethod("GET"), true);
    assert.equal(isPwaHealthMethod("HEAD"), true);
    assert.equal(isPwaHealthMethod("POST"), false);
  });

  it("GET is 200 JSON and HEAD is empty, with the same PWA security headers", async () => {
    const headers = { host: "ahanu.dev" };
    const getReq = new Request("https://ahanu.dev/health", { headers });
    const get = applyPwaSecurityHeaders(getReq, pwaHealthResponse(getReq));
    assert.equal(get.status, 200);
    const body = JSON.parse(await get.text());
    assert.equal(body.ok, true);
    assert.equal(body.service, "ahanu");
    assert.equal(get.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(get.headers.get("Cache-Control"), "no-store");
    assert.equal(get.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(get.headers.get("X-Frame-Options"), "DENY");
    assert.equal(get.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
    assert.ok(get.headers.get("Strict-Transport-Security")?.includes("max-age=31536000"));
    assert.match(get.headers.get("Content-Security-Policy") ?? "", /worker-src 'self' blob:/);

    const headReq = new Request("https://ahanu.dev/health", { method: "HEAD", headers });
    const head = applyPwaSecurityHeaders(headReq, pwaHealthResponse(headReq));
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal(head.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(head.headers.get("Cache-Control"), "no-store");
    assert.equal(head.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(head.headers.get("X-Frame-Options"), "DENY");
    assert.ok(head.headers.get("Strict-Transport-Security")?.includes("max-age=31536000"));
  });
});


describe("packs CORS + security headers", () => {
  it("reflects helm Origin and never sends *", () => {
    const helm = packsSecurityHeaders(
      new Request("https://api.ahanu.dev/health", {
        headers: { Origin: HELM_APEX_ORIGIN, host: "api.ahanu.dev" },
      }),
    );
    assert.equal(helm["Access-Control-Allow-Origin"], HELM_APEX_ORIGIN);
    assert.equal(helm["X-Content-Type-Options"], "nosniff");
    assert.ok(helm["Strict-Transport-Security"]?.includes("max-age=31536000"));
    assert.equal(Object.values(helm).includes("*"), false);

    const other = packsSecurityHeaders(
      new Request("https://api.ahanu.dev/health", {
        headers: { Origin: "https://evil.example", host: "api.ahanu.dev" },
      }),
    );
    assert.equal(other["Access-Control-Allow-Origin"], undefined);

    const none = packsSecurityHeaders(
      new Request("https://api.ahanu.dev/health", { headers: { host: "api.ahanu.dev" } }),
    );
    assert.equal(none["Access-Control-Allow-Origin"], undefined);
  });

  it("keeps skipCache Cache-Control and pack ids", () => {
    const inner = new Response("{}", {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Ahanu-Pack-Id": "pack_test",
        ETag: '"abc"',
      },
    });
    const out = applyPacksSecurityHeaders(
      new Request("https://api.ahanu.dev/api/packs?skipCache=1", {
        headers: { Origin: HELM_APEX_ORIGIN, host: "api.ahanu.dev" },
      }),
      inner,
    );
    assert.equal(out.headers.get("Cache-Control"), "no-store");
    assert.equal(out.headers.get("X-Ahanu-Pack-Id"), "pack_test");
    assert.equal(out.headers.get("ETag"), '"abc"');
    assert.equal(out.headers.get("Access-Control-Allow-Origin"), HELM_APEX_ORIGIN);
    assert.equal(out.headers.get("X-Content-Type-Options"), "nosniff");
  });

  it("preview OPTIONS reflects helm and denies strangers", async () => {
    const ok = await handlePacksRequest(
      new Request("http://localhost/api/packs", {
        method: "OPTIONS",
        headers: { Origin: HELM_WORKERS_ORIGIN },
      }),
    );
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get("Access-Control-Allow-Origin"), HELM_WORKERS_ORIGIN);
    assert.equal(ok.headers.get("X-Content-Type-Options"), "nosniff");

    const no = await handlePacksRequest(
      new Request("http://localhost/api/nope", { headers: { Origin: "https://evil.example" } }),
    );
    assert.equal(no.status, 404);
    assert.equal(no.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(no.headers.get("X-Content-Type-Options"), "nosniff");
  });

  it("Worker /health and OPTIONS stay readable from helm, not *", async () => {
    const env = healthEnv();
    const health = await worker.fetch(
      new Request("http://api.ahanu.dev/health", {
        headers: { Origin: HELM_WWW_ORIGIN, host: "api.ahanu.dev" },
      }),
      env,
    );
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("Access-Control-Allow-Origin"), HELM_WWW_ORIGIN);
    assert.equal(health.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(health.headers.get("X-Ahanu-Ndbc"), "live");
    assert.equal(health.headers.get("Cache-Control"), "no-store");
    assert.ok(health.headers.get("Strict-Transport-Security")?.includes("max-age=31536000"));
    assert.notEqual(health.headers.get("Access-Control-Allow-Origin"), "*");

    const preflight = await worker.fetch(
      new Request("http://api.ahanu.dev/api/packs", {
        method: "OPTIONS",
        headers: {
          Origin: HELM_APEX_ORIGIN,
          host: "api.ahanu.dev",
          "Access-Control-Request-Method": "GET",
        },
      }),
      env,
    );
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), HELM_APEX_ORIGIN);
    assert.equal(
      preflight.headers.get("Access-Control-Allow-Headers")?.includes("Authorization"),
      true,
    );
    assert.equal(preflight.headers.get("X-Content-Type-Options"), "nosniff");
  });

  it("HEAD /health and HEAD / are 200 with the same security/cache/Ndbc headers as GET", async () => {
    const env = healthEnv();
    const headers = { Origin: HELM_WWW_ORIGIN, host: "api.ahanu.dev" };
    const get = await worker.fetch(new Request("http://api.ahanu.dev/health", { headers }), env);
    assert.equal(get.status, 200);
    const getBody = await get.text();
    assert.ok(getBody.includes('"ok": true'));

    for (const path of ["/health", "/"] as const) {
      const head = await worker.fetch(
        new Request(`http://api.ahanu.dev${path}`, { method: "HEAD", headers }),
        env,
      );
      assert.equal(head.status, 200, `HEAD ${path}`);
      assert.equal(head.headers.get("Access-Control-Allow-Origin"), HELM_WWW_ORIGIN);
      assert.equal(head.headers.get("X-Content-Type-Options"), "nosniff");
      assert.equal(head.headers.get("X-Ahanu-Ndbc"), get.headers.get("X-Ahanu-Ndbc"));
      assert.equal(head.headers.get("Cache-Control"), "no-store");
      assert.ok(head.headers.get("Strict-Transport-Security")?.includes("max-age=31536000"));
      assert.equal(head.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
      assert.notEqual(head.headers.get("Access-Control-Allow-Origin"), "*");
      assert.equal(await head.text(), "");
    }
  });
});
