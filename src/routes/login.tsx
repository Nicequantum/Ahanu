import { createFileRoute, Link } from "@tanstack/react-router";
import { GROK_PROVIDERS, authEnabled, signIn, authClient } from "@/lib/auth/client";
import { emailAndPasswordEnabled } from "@/lib/auth/email-password";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState, type FormEvent } from "react";
import { Anchor, Compass } from "lucide-react";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"in" | "up">("in");
  const [err, setErr] = useState<string | null>(null);

  async function onEmail(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      if (mode === "up") {
        await authClient.signUp.email({ email, password, name: email.split("@")[0] ?? "Skipper" });
      } else {
        await authClient.signIn.email({ email, password });
      }
      window.location.href = "/";
    } catch (er) {
      setErr(er instanceof Error ? er.message : "Could not sign in");
    }
  }

  return (
    <main className="relative grid min-h-svh place-items-center overflow-hidden bg-abyss px-5">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(1200px 500px at 50% 110%, rgb(78 205 196 / 0.12), transparent 55%), radial-gradient(800px 400px at 80% 0%, rgb(228 181 106 / 0.12), transparent 50%)",
        }}
      />
      <div className="relative w-full max-w-sm">
        <Link to="/" className="mb-8 flex items-center gap-3 text-foam">
          <span className="grid size-11 place-items-center rounded-xl bg-sunrise text-sunrise-fg">
            <Compass className="size-5" />
          </span>
          <span>
            <span className="font-display block text-3xl leading-none">Ahanu</span>
            <span className="text-xs tracking-[0.22em] text-muted uppercase">ah-HAH-noo · he laughs</span>
          </span>
        </Link>
        <p className="mb-6 text-sm text-muted">
          Sign in to sync catch logs when you are back in range. The bridge itself runs fully offline.
        </p>
        {authEnabled ? (
          <div className="space-y-2">
            {GROK_PROVIDERS.map((p) => (
              <Button
                key={p.providerId}
                type="button"
                variant="outline"
                className="w-full justify-between"
                onClick={() => signIn(p.providerId, { callbackURL: "/" })}
              >
                Continue with {p.label}
                <Anchor className="size-4 text-sunrise" />
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">Sign-in is disabled in this environment.</p>
        )}
        {emailAndPasswordEnabled && (
          <form onSubmit={onEmail} className="mt-6 space-y-2">
            <p className="text-[11px] tracking-widest text-faint uppercase">Email · this vessel</p>
            <Input
              type="email"
              required
              placeholder="skipper@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              type="password"
              required
              minLength={8}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {err && <p className="text-xs text-nogo">{err}</p>}
            <Button type="submit" className="w-full">
              {mode === "in" ? "Sign in with email" : "Create skipper account"}
            </Button>
            <button
              type="button"
              className="w-full text-xs text-muted underline-offset-4 hover:underline"
              onClick={() => setMode(mode === "in" ? "up" : "in")}
            >
              {mode === "in" ? "Need an account?" : "Already have an account?"}
            </button>
          </form>
        )}
        <Link to="/" className="mt-8 inline-block text-sm text-lagoon underline-offset-4 hover:underline">
          Continue as guest — the chartplotter does not wait
        </Link>
      </div>
    </main>
  );
}
