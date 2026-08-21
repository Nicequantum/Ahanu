import "./register-alias.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const {
  PWA_THEME_COLOR,
  PWA_WEB_MANIFEST,
  isPwaManifestMethod,
  isPwaManifestPath,
  pwaManifestBody,
  pwaManifestResponse,
} = await import("../src/lib/ahanu/pwa-manifest.ts");
const { applyPwaSecurityHeaders } = await import("../src/lib/ahanu/security-headers.ts");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("PWA web app manifest", () => {
  it("matches install / offline chrome fields", () => {
    assert.equal(PWA_WEB_MANIFEST.name, "Ahanu");
    assert.equal(PWA_WEB_MANIFEST.short_name, "Ahanu");
    assert.equal(PWA_WEB_MANIFEST.start_url, "/");
    assert.equal(PWA_WEB_MANIFEST.scope, "/");
    assert.equal(PWA_WEB_MANIFEST.display, "standalone");
    assert.equal(PWA_WEB_MANIFEST.theme_color, PWA_THEME_COLOR);
    assert.equal(PWA_WEB_MANIFEST.background_color, "#071016");
    assert.equal(PWA_WEB_MANIFEST.icons[0]?.src, "/__grok/icon-180.png");
    assert.equal(PWA_WEB_MANIFEST.icons[1]?.src, "/favicon.svg");
  });

  it("ships in public/ and stays in lockstep with the Worker body", () => {
    const shipped = readFileSync(join(ROOT, "public/manifest.webmanifest"), "utf8");
    assert.deepEqual(JSON.parse(shipped), JSON.parse(pwaManifestBody()));
  });

  it("is linked from the helm document head", () => {
    const root = readFileSync(join(ROOT, "src/routes/__root.tsx"), "utf8");
    assert.match(root, /rel:\s*"manifest"/);
    assert.match(root, /href:\s*"\/manifest\.webmanifest"/);
    assert.doesNotMatch(root, /href:\s*"\/__grok\/manifest\.webmanifest"/);
  });

  it("Vite plugin, Nitro middleware, and Start Worker all serve /manifest.webmanifest", () => {
    const plugin = readFileSync(join(ROOT, "scripts/grok-pwa-plugin.mjs"), "utf8");
    const nitro = readFileSync(join(ROOT, "server/middleware/grok-pwa.ts"), "utf8");
    const start = readFileSync(join(ROOT, "src/start.ts"), "utf8");
    const shared = readFileSync(join(ROOT, "scripts/grok-pwa-shared.mjs"), "utf8");
    assert.match(plugin, /isWebManifestPath/);
    assert.match(nitro, /isWebManifestPath/);
    assert.match(start, /isPwaManifestPath/);
    assert.match(start, /pwaManifestResponse/);
    assert.match(shared, /href="\/manifest\.webmanifest"/);
  });

  it("matches only GET/HEAD on the manifest paths, not the SPA catch-all", () => {
    assert.equal(isPwaManifestPath("/manifest.webmanifest"), true);
    assert.equal(isPwaManifestPath("/manifest.webmanifest/"), true);
    assert.equal(isPwaManifestPath("/__grok/manifest.webmanifest"), true);
    assert.equal(isPwaManifestPath("/manifest.json"), true);
    assert.equal(isPwaManifestPath("/"), false);
    assert.equal(isPwaManifestPath("/login"), false);
    assert.equal(isPwaManifestPath("/health"), false);
    assert.equal(isPwaManifestMethod("GET"), true);
    assert.equal(isPwaManifestMethod("HEAD"), true);
    assert.equal(isPwaManifestMethod("POST"), false);
  });

  it("GET is 200 JSON and HEAD is empty, with PWA security headers", async () => {
    const headers = { host: "ahanu.dev" };
    const getReq = new Request("https://ahanu.dev/manifest.webmanifest", { headers });
    const get = applyPwaSecurityHeaders(getReq, pwaManifestResponse(getReq));
    assert.equal(get.status, 200);
    const body = JSON.parse(await get.text());
    assert.equal(body.name, "Ahanu");
    assert.equal(body.start_url, "/");
    assert.equal(body.display, "standalone");
    assert.equal(body.theme_color, "#071016");
    assert.equal(get.headers.get("content-type"), "application/manifest+json; charset=utf-8");
    assert.equal(get.headers.get("Cache-Control"), "no-cache");
    assert.equal(get.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(get.headers.get("X-Frame-Options"), "DENY");
    assert.match(get.headers.get("Content-Security-Policy") ?? "", /manifest-src 'self'/);

    const headReq = new Request("https://ahanu.dev/manifest.webmanifest", {
      method: "HEAD",
      headers,
    });
    const head = applyPwaSecurityHeaders(headReq, pwaManifestResponse(headReq));
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal(head.headers.get("content-type"), "application/manifest+json; charset=utf-8");
    assert.ok(head.headers.get("Strict-Transport-Security")?.includes("max-age=31536000"));
  });
});
