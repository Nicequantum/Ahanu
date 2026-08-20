import type { Plugin, ViteDevServer } from "vite";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
// @ts-expect-error JS plugin alongside the TS vite config
import { grokPwaPlugin } from "./scripts/grok-pwa-plugin.mjs";
import {
  invalidatePackSsrGraph,
  isAhanuPackSsrFile,
  packSsrSurfaces,
  PACK_SSR_ENTRY,
  watchAhanuPackDir,
} from "./scripts/pack-ssr-invalidate";

/**
 * Cloudflare Workers Builds sets WORKERS_CI. Pages sets CF_PAGES.
 * `AHANU_CF=1` is the explicit switch for `npm run deploy:cf`.
 * Cloudflare CI also injects CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID,
 * which is how a dashboard command of `npx wrangler deploy` still takes
 * this path. The Grok preview `npm run build` has none of these — Nitro stays so the preview host can serve the PWA. That path is not production.
 */
function isCloudflareBuild(): boolean {
  return (
    process.env.AHANU_CF === "1" ||
    process.env.WORKERS_CI === "1" ||
    process.env.CF_PAGES === "1" ||
    Boolean(process.env.CLOUDFLARE_API_TOKEN) ||
    Boolean(process.env.CLOUDFLARE_ACCOUNT_ID)
  );
}

/** Live ahanu-packs Worker. workers.dev only — api.ahanu.app is not provisioned. */
const DEFAULT_PACKS_WORKER_URL = "https://ahanu-packs.hombre3536.workers.dev";

/**
 * Finish PGLite bootstrap during dev-server setup (before traffic). Vite awaits
 * async `configureServer` hooks. Production: `src/lib/db` kicks `ensureDbReady`
 * on import.
 */

function bustPackSsr(server: ViteDevServer) {
  const { graph, runner } = packSsrSurfaces(server);
  if (graph) invalidatePackSsrGraph(graph, runner);
}

function ahanuPacksPlugin(): Plugin {
  return {
    name: "ahanu-packs-api",
    apply: "serve",
    configureServer(server) {
      watchAhanuPackDir(server.watcher, server.config.root);
      server.watcher.on("change", (file) => {
        if (isAhanuPackSsrFile(file)) bustPackSsr(server);
      });
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url ?? "";
        const pathOnly = rawUrl.split("?", 1)[0] ?? "";
        const method = (req.method ?? "GET").toUpperCase();
        const hit =
          pathOnly === "/api/packs" ||
          pathOnly === "/api/objects" ||
          pathOnly.startsWith("/api/objects/") ||
          pathOnly === "/api/catches";
        if (!hit) {
          next();
          return;
        }
        try {
          const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost:8080");
          const proto = String(
            req.headers["x-forwarded-proto"] ??
              ((req.socket as { encrypted?: boolean } | undefined)?.encrypted ? "https" : "http"),
          );
          const requestHeaders = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (value === undefined) continue;
            if (Array.isArray(value)) {
              for (const v of value) requestHeaders.append(key, v);
            } else {
              requestHeaders.set(key, value);
            }
          }
          const chunks: Buffer[] = [];
          if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
            await new Promise<void>((resolve, reject) => {
              req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
              req.on("end", () => resolve());
              req.on("error", reject);
            });
          }
          const body = chunks.length ? Buffer.concat(chunks) : undefined;
          const request = new Request(`${proto}://${host}${rawUrl}`, {
            method,
            headers: requestHeaders,
            body: body && body.length ? new Uint8Array(body) : undefined,
          });
          bustPackSsr(server);
          const mod = (await server.ssrLoadModule(PACK_SSR_ENTRY)) as {
            handlePacksRequest: (req: Request) => Promise<Response>;
          };
          const response = await mod.handlePacksRequest(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });
          const out = Buffer.from(await response.arrayBuffer());
          res.end(out);
        } catch (err) {
          console.error("[ahanu] pack API failed:", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "pack api failed" }));
          }
        }
      });
    },
  };
}

function pgliteBootstrapPlugin(): Plugin {
  return {
    name: "ahanu:pglite-bootstrap",
    apply: "serve",
    async configureServer(server) {
      try {
        const mod = (await server.ssrLoadModule("/src/lib/db.ts")) as {
          ensureDbReady?: () => Promise<void>;
        };
        if (typeof mod.ensureDbReady === "function") {
          await mod.ensureDbReady();
        }
      } catch (err) {
        console.error("[ahanu] DB bootstrap failed:", err);
        throw err;
      }
    },
  };
}

/**
 * Live-preview OAuth popup — handled HERE so the agent never has to create a
 * `/auth/popup` route (and cannot break it by scaffolding a React page that
 * paints the full app shell in the popup).
 *
 * `signIn` (client.ts) opens `/auth/popup?providerId=…` in a top-level window.
 * This middleware runs before TanStack Start, calls `handleAuthPopupRequest`,
 * and returns the 302 / completion HTML. Deployed apps do not use the popup
 * (full-page OAuth redirect), so `apply: "serve"` is enough.
 */
function authPopupPlugin(): Plugin {
  return {
    name: "ahanu:auth-popup",
    apply: "serve",
    configureServer(server) {
      // Register immediately (not in a returned post-hook) so we run BEFORE
      // TanStack Start / the SPA HTML fallback. A model-authored
      // `src/routes/auth/popup.tsx` React page must never win this path.
      server.middlewares.use(async (req, res, next) => {
        try {
          const rawUrl = req.url ?? "";
          const pathOnly = rawUrl.split("?", 1)[0] ?? "";
          if (pathOnly !== "/auth/popup") {
            next();
            return;
          }
          if ((req.method ?? "GET").toUpperCase() !== "GET") {
            res.statusCode = 405;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("Method Not Allowed");
            return;
          }

          const host = String(
            req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost:8080",
          );
          const proto = String(
            req.headers["x-forwarded-proto"] ??
              ((req.socket as { encrypted?: boolean } | undefined)?.encrypted ? "https" : "http"),
          );
          const requestHeaders = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (value === undefined) continue;
            if (Array.isArray(value)) {
              for (const v of value) requestHeaders.append(key, v);
            } else {
              requestHeaders.set(key, value);
            }
          }
          // Ensure Host is the public preview host so Better Auth's dynamic
          // baseURL / redirect_uri match the popup origin.
          if (!requestHeaders.has("host")) requestHeaders.set("host", host);

          const request = new Request(`${proto}://${host}${rawUrl}`, {
            method: "GET",
            headers: requestHeaders,
          });

          const mod = (await server.ssrLoadModule("/src/lib/auth/popup.server.ts")) as {
            handleAuthPopupRequest: (req: Request) => Promise<Response>;
          };
          const response = await mod.handleAuthPopupRequest(request);

          res.statusCode = response.status;
          // Preserve multiple Set-Cookie headers (OAuth state + session).
          const setCookies =
            typeof response.headers.getSetCookie === "function"
              ? response.headers.getSetCookie()
              : [];
          response.headers.forEach((value, key) => {
            if (key.toLowerCase() === "set-cookie") return;
            res.setHeader(key, value);
          });
          for (const cookie of setCookies) {
            res.appendHeader("set-cookie", cookie);
          }
          const body = Buffer.from(await response.arrayBuffer());
          res.end(body);
        } catch (err) {
          console.error("[ahanu] /auth/popup handler failed:", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("auth popup failed");
          }
        }
      });
    },
  };
}

// `0.0.0.0:8080` is the Vite/TanStack preview-host contract — don't change host/port.
export default defineConfig(({ command, isPreview }) => {
  const cf = isCloudflareBuild();
  // Helm reads import.meta.env.VITE_AHANU_PACKS_URL (pack-client packsApiBase).
  // Local Vite leaves it unset so Packs hits same-origin /api/packs.
  // CF / production PWA builds default to the live Worker unless already set.
  if (cf && !process.env.VITE_AHANU_PACKS_URL) {
    process.env.VITE_AHANU_PACKS_URL = DEFAULT_PACKS_WORKER_URL;
  }

  return {
    server: {
      host: "0.0.0.0",
      port: 8080,
      strictPort: true,
    },
    preview: {
      host: "127.0.0.1",
      port: 8081,
      strictPort: true,
    },
    resolve: { tsconfigPaths: true },
    // MapLibre is a browser WebGL client. Exclude it from Vite's dep optimizer
    // in *dev* so the map worker loads. Never set `ssr.external` — Cloudflare's
    // Vite plugin rejects `resolve.external` on the SSR worker environment.
    optimizeDeps: command === "serve" ? { exclude: ["maplibre-gl"] } : undefined,
    plugins: [
      pgliteBootstrapPlugin(),
      ahanuPacksPlugin(),
      // Before tanstackStart so /auth/popup never falls through to the SPA.
      authPopupPlugin(),
      // PWA head + ?install=1 tutorial page; runs before Start/Nitro.
      grokPwaPlugin(),
      tailwindcss(),
      ...(cf ? [cloudflare({ viteEnvironment: { name: "ssr" } })] : []),
      tanstackStart(),
      ...(!cf && (command === "build" || isPreview)
        ? [
            nitro({
              // Nitro + Vercel preset: Grok preview host only. Production is
              // `AHANU_CF=1` / Cloudflare. Do not treat this as the ship path.
              preset: "vercel",
              // Auto-registers server/middleware/* (the PWA install page +
              // manifest + head-tag middleware). Nitro v3 defaults serverDir to
              // false, so removing this silently unwires /?install=1 on the preview host.
              serverDir: "./server",
            }),
          ]
        : []),
      viteReact(),
    ],
  };
});
