/**
 * Web app manifest for the Ahanu PWA Worker.
 * Served at /manifest.webmanifest so install / offline chrome can find it.
 * Icons are the existing helm assets — no invented brand art.
 */

export const PWA_THEME_COLOR = "#071016";

export const PWA_WEB_MANIFEST = {
  name: "Ahanu",
  short_name: "Ahanu",
  description: "Ahanu — offline-first marine OS for Northeast canyon anglers. He who laughs.",
  id: "/",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: PWA_THEME_COLOR,
  theme_color: PWA_THEME_COLOR,
  icons: [
    {
      src: "/__grok/icon-180.png",
      sizes: "180x180",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/favicon.svg",
      sizes: "any",
      type: "image/svg+xml",
      purpose: "any",
    },
  ],
} as const;

const MANIFEST_PATHS = new Set([
  "/manifest.webmanifest",
  "/manifest.json",
  "/__grok/manifest.webmanifest",
  "/__grok/manifest.json",
]);

export function isPwaManifestPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return MANIFEST_PATHS.has(path);
}

export function isPwaManifestMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === "GET" || m === "HEAD";
}

export function pwaManifestBody(): string {
  return `${JSON.stringify(PWA_WEB_MANIFEST, null, 2)}\n`;
}

/** GET: application/manifest+json. HEAD: same status/headers, empty body. */
export function pwaManifestResponse(request: Request): Response {
  const headers = {
    "Content-Type": "application/manifest+json; charset=utf-8",
    "Cache-Control": "no-cache",
  };
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  return new Response(pwaManifestBody(), { status: 200, headers });
}
