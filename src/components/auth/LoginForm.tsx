"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ACCESS_MESSAGE, isAllowedEmail, normalizeEmail } from "@/lib/auth/domain";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { SendCodeResponse } from "@/app/api/auth/send/route";

const ERRORS: Record<string, string> = {
  domain: ACCESS_MESSAGE,
  link: "That sign-in link is not valid any more. Enter your email to get a new one.",
  unconfigured: "Sign-in is not configured on this server yet.",
};

export function LoginForm({ initialError }: { initialError?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"EMAIL" | "SENT">("EMAIL");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(initialError ? ERRORS[initialError] ?? initialError : undefined);

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
    if (token.length < 6) { setError("Enter the 6-digit code from the email."); return; }
    const supabase = getBrowserSupabase();
    if (!supabase) { setError(ERRORS.unconfigured); return; }
    setBusy(true);
    try {
      const { data, error: err } = await supabase.auth.verifyOtp({ email, token, type: "email" });
      if (err || !data.user?.email) { setError("That code did not work. Check it, or use the link in the email."); return; }
      if (!isAllowedEmail(data.user.email)) { await supabase.auth.signOut(); setError(ACCESS_MESSAGE); return; }
      router.replace("/plan");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand">UW GO</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">Your Waterloo day,<br />figured out.</h1>

      {step === "EMAIL" ? (
        <form className="card mt-6 p-4" onSubmit={submitEmail}>
          <label htmlFor="email" className="text-lg font-semibold">Sign in with your Waterloo email</label>
          <input
            id="email"
            className="field mt-3"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            placeholder="d123mugh@uwaterloo.ca"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {error && <p className="mt-2 text-sm text-bad" role="alert">{error}</p>}
          <button className="btn btn-primary mt-3 w-full text-lg" type="submit" disabled={busy || !email.trim()}>{busy ? "Sending…" : "Continue"}</button>
          <p className="mt-3 text-xs text-ink-muted">We email you a sign-in link. No password to remember.</p>
        </form>
      ) : (
        <form className="card mt-6 p-4" onSubmit={submitCode}>
          <h2 className="text-lg font-semibold">Check your Waterloo inbox</h2>
          <p className="mt-1 text-sm text-ink-muted">We sent a sign-in link to <span className="font-semibold text-ink">{email}</span>. Open it on this device to enter UW GO.</p>
          <p className="mt-3 text-sm text-ink-muted">Reading the email on another device? Enter the 6-digit code from it here instead.</p>
          <input
            className="field mt-2 font-mono text-lg tracking-widest"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          {error && <p className="mt-2 text-sm text-bad" role="alert">{error}</p>}
          <button className="btn btn-primary mt-3 w-full" type="submit" disabled={busy || code.replace(/\D/g, "").length < 6}>{busy ? "Checking…" : "Enter UW GO"}</button>
          <button className="btn btn-ghost mt-1 w-full" type="button" onClick={() => { setStep("EMAIL"); setCode(""); setError(undefined); }}>Use a different email</button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-ink-muted">Currently available to University of Waterloo students.</p>
    </main>
  );
}
