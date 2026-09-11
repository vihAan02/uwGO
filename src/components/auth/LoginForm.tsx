"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ACCESS_MESSAGE, isAllowedEmail, normalizeEmail } from "@/lib/auth/domain";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { SendCodeResponse } from "@/app/api/auth/send/route";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Reveal } from "@/components/ui/reveal";
import { Wordmark } from "@/components/ui/wordmark";

/** Only these codes are ever shown; anything else in ?error= is ignored rather than printed. */
const ERRORS: Record<string, string> = {
  domain: ACCESS_MESSAGE,
  unconfigured: "Sign-in is not configured on this server yet.",
};

export function LoginForm({ initialError }: { initialError?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"EMAIL" | "SENT">("EMAIL");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(initialError ? ERRORS[initialError] : undefined);

  const submitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    const normalized = normalizeEmail(email);
    if (!normalized.includes("@")) { setError("Enter your Waterloo email address."); return; }
    if (!isAllowedEmail(normalized)) { setError(ACCESS_MESSAGE); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: normalized }) });
      const json = (await res.json()) as SendCodeResponse;
      if (!res.ok || !json.ok) { setError(json.error ?? "Could not send the sign-in email."); return; }
      setEmail(normalized);
      setStep("SENT");
    } catch {
      setError("Could not reach the sign-in service.");
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    const token = code.replace(/\D/g, "");
    if (token.length < 6) { setError("Enter the code from the email."); return; }
    const supabase = getBrowserSupabase();
    if (!supabase) { setError(ERRORS.unconfigured); return; }
    setBusy(true);
    try {
      const { data, error: err } = await supabase.auth.verifyOtp({ email, token, type: "email" });
      if (err || !data.user?.email) { setError("That code did not work. Check the email and try again."); return; }
      if (!isAllowedEmail(data.user.email)) { await supabase.auth.signOut(); setError(ACCESS_MESSAGE); return; }
      router.replace("/plan");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app flex min-h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center px-5 sm:px-8">
        <Wordmark href="/" />
      </header>

      <Reveal key={step} className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5 pb-28 sm:px-0">
        {step === "EMAIL" ? (
          <form onSubmit={submitEmail} noValidate>
            <h1 data-reveal className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">Sign in</h1>
            <p data-reveal className="mt-2 text-ink-muted">
              Use your @uwaterloo.ca email. We email you a sign-in code, so there is no password to remember.
            </p>
            <div data-reveal className="mt-8 flex flex-col gap-2">
              <Label htmlFor="email">Waterloo email</Label>
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoFocus
                placeholder="you@uwaterloo.ca"
                value={email}
                aria-invalid={Boolean(error) || undefined}
                onChange={(e) => setEmail(e.target.value)}
              />
              {error && <p className="text-sm text-bad" role="alert">{error}</p>}
            </div>
            <Button data-reveal size="lg" className="mt-4 w-full" type="submit" disabled={busy || !email.trim()}>
              {busy ? "Sending…" : "Send code"}
            </Button>
          </form>
        ) : (
          <form onSubmit={submitCode} noValidate>
            <h1 data-reveal className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">Check your inbox</h1>
            <p data-reveal className="mt-2 text-ink-muted">
              We sent a sign-in code to <span className="font-medium text-ink">{email}</span>. It can take a minute to arrive.
            </p>
            <div data-reveal className="mt-8 flex flex-col gap-2">
              <Label htmlFor="code">Sign-in code</Label>
              <Input
                id="code"
                className="font-mono text-lg tracking-[0.3em] placeholder:font-sans placeholder:text-base placeholder:tracking-normal"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={10}
                placeholder="Enter the code"
                value={code}
                aria-invalid={Boolean(error) || undefined}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
              {error && <p className="text-sm text-bad" role="alert">{error}</p>}
            </div>
            <Button data-reveal size="lg" className="mt-4 w-full" type="submit" disabled={busy || code.length < 6}>
              {busy ? "Checking…" : "Sign in"}
            </Button>
            <Button data-reveal variant="ghost" className="mt-2 w-full" type="button" onClick={() => { setStep("EMAIL"); setCode(""); setError(undefined); }}>
              Use a different email
            </Button>
          </form>
        )}
        <p data-reveal className="mt-10 text-center text-xs text-ink-muted">Currently available to University of Waterloo students.</p>
      </Reveal>
    </main>
  );
}
