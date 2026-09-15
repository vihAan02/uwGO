"use client";
import { AlertTriangle, Loader2, RotateCw } from "lucide-react";
import { useUserState } from "@/lib/UserStateProvider";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/ui/wordmark";

function Shell({ children, busy }: { children: React.ReactNode; busy?: boolean }) {
  return (
    <main className="app flex min-h-screen flex-col" aria-busy={busy || undefined}>
      <header className="flex h-14 shrink-0 items-center px-5 sm:px-8">
        <Wordmark />
      </header>
      {children}
    </main>
  );
}

/** Shown while the saved schedule is read after sign-in, so onboarding never flashes first. */
export function AccountLoading() {
  return (
    <Shell busy>
      <div role="status" className="flex flex-1 flex-col items-center justify-center gap-3 px-5 pb-28 text-ink-muted">
        <Loader2 className="size-5 motion-safe:animate-spin" aria-hidden="true" />
        <p className="text-sm">Loading your schedule…</p>
      </div>
    </Shell>
  );
}

/** The read failed and this device has nothing to show. Nothing was changed; retry, or set up here. */
export function AccountLoadError() {
  const account = useUserState();
  return (
    <Shell>
      <div role="alert" className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5 pb-28 sm:px-0">
        <AlertTriangle className="size-5 text-warn" aria-hidden="true" />
        <h1 className="mt-3 text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">We couldn&rsquo;t load your schedule</h1>
        <p className="mt-2 text-ink-muted">Check your connection and try again. Nothing saved to your account has been changed.</p>
        <Button size="lg" className="mt-8 w-full" onClick={account.retry}>
          <RotateCw /> Try again
        </Button>
        <Button variant="ghost" size="touch" className="mt-2 w-full" onClick={account.continueOffline}>
          Set up on this device instead
        </Button>
      </div>
    </Shell>
  );
}

/** A slim notice inside the app when the account cannot be reached or the last save failed. */
export function AccountSyncNotice() {
  const account = useUserState();
  const unreachable = account.status === "error" || account.status === "offline";
  if (!unreachable && !account.saveError) return null;
  return (
    <div role="status" className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        <AlertTriangle className="size-4 shrink-0 text-warn" aria-hidden="true" />
        <span className="min-w-0">
          {unreachable ? "Can’t reach your account. Changes stay on this device for now." : "Your latest changes aren’t saved to your account yet."}
        </span>
      </span>
      <Button variant="outline" size="touch" className="shrink-0" onClick={account.retry}>Retry</Button>
    </div>
  );
}
