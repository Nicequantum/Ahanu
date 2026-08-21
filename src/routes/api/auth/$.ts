import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { betterAuthSecretReady } from "@/lib/auth/secret";

function refuseIfSecretMissing(): Response | null {
  if (betterAuthSecretReady()) return null;
  return new Response(
    JSON.stringify({ error: "unauthorized", hint: "BETTER_AUTH_SECRET is not configured" }, null, 2),
    {
      status: 503,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}

async function handleAuth(request: Request): Promise<Response> {
  const denied = refuseIfSecretMissing();
  if (denied) return denied;
  return auth.handler(request);
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleAuth(request),
      POST: ({ request }) => handleAuth(request),
    },
  },
});
