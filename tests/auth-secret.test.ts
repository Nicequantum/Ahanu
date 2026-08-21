import "./register-alias.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { betterAuthSecretReady, resolveBetterAuthSecret } = await import("../src/lib/auth/secret.ts");

describe("Better Auth secret fail-closed", () => {
  it("uses the env secret when present", () => {
    const got = resolveBetterAuthSecret({ envSecret: "  dock-auth  ", cloudflare: true });
    assert.equal(got.source, "env");
    assert.equal(got.secret, "dock-auth");
    assert.equal(betterAuthSecretReady({ envSecret: "dock-auth", cloudflare: true }), true);
  });

  it("Cloudflare without BETTER_AUTH_SECRET fails closed", () => {
    const missing = resolveBetterAuthSecret({ envSecret: "", cloudflare: true });
    assert.equal(missing.source, "missing");
    assert.equal(missing.secret, "");
    assert.equal(betterAuthSecretReady({ envSecret: "   ", cloudflare: true }), false);
  });

  it("local preview mints a process random, not a public constant", () => {
    const got = resolveBetterAuthSecret({ envSecret: "", cloudflare: false, previewRandom: "preview-only" });
    assert.equal(got.source, "preview-random");
    assert.equal(got.secret, "preview-only");
    assert.equal(betterAuthSecretReady({ envSecret: "", cloudflare: false }), true);
  });

  it("source has no hardcoded CF preview fallback string", () => {
    const files = [
      "src/lib/auth/server.ts",
      "src/lib/auth/secret.ts",
      "src/routes/api/auth/$.ts",
    ];
    for (const rel of files) {
      const src = readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
      assert.equal(
        src.includes("ahanu-cf-preview-auth-secret-set-BETTER_AUTH_SECRET"),
        false,
        rel,
      );
    }
  });
});
