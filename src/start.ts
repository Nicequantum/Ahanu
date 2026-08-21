import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { applyPwaSecurityHeaders } from "./lib/ahanu/security-headers";

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

const securityHeadersMiddleware = createMiddleware({ type: "request" }).server(
  async ({ next, request }) => {
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
