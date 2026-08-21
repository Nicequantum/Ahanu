import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { applyPwaSecurityHeaders } from "./lib/ahanu/security-headers";
import { isPwaHealthMethod, isPwaHealthPath, pwaHealthResponse } from "./lib/ahanu/pwa-health";
import {
  isPwaManifestMethod,
  isPwaManifestPath,
  pwaManifestResponse,
} from "./lib/ahanu/pwa-manifest";

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

const securityHeadersMiddleware = createMiddleware({ type: "request" }).server(
  async ({ next, request, pathname }) => {
    if (isPwaHealthPath(pathname) && isPwaHealthMethod(request.method)) {
      return applyPwaSecurityHeaders(request, pwaHealthResponse(request));
    }
    if (isPwaManifestPath(pathname) && isPwaManifestMethod(request.method)) {
      return applyPwaSecurityHeaders(request, pwaManifestResponse(request));
    }
    const result = await next();
    return {
      ...result,
      response: applyPwaSecurityHeaders(request, result.response),
    };
  },
);

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, securityHeadersMiddleware],
}));
