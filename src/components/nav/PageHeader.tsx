"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, SlidersHorizontal, UserRound } from "lucide-react";
import { initialHeaderScroll, nextHeaderScroll } from "@/lib/headerScroll";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/ui/wordmark";
import { AppTabs } from "./AppTabs";

/**
 * The header of a secondary page such as /courses (DESIGN.md §13). On a phone: a compact opaque bar with
 * the way back to the plan, the page's name and the profile, which steps out of the way while the
 * student scrolls down and returns on a deliberate scroll up, near the top, or when focus enters it.
 * On a wide screen: the ordinary header with the app's tabs, which stays put.
 */
export function PageHeader({ title, onOpenSettings, initial }: {
  title: string;
  onOpenSettings: () => void;
  /** The first letter of the student's email, for the profile button. */
  initial?: string;
}) {
  const [hidden, setHidden] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    let run = initialHeaderScroll(window.scrollY);
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const next = nextHeaderScroll(run, window.scrollY, max);
        if (next === run) return;
        run = next;
        setHidden(!next.visible);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  const away = hidden && !focused;
  return (
    <header
      data-away={away}
      onFocus={() => setFocused(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}
      className={cn(
        "sticky top-0 z-30 border-b border-line bg-canvas pt-[env(safe-area-inset-top)]",
        // Tailwind's translate utilities set `translate`, so that is the property to transition.
        "transition-[translate,opacity] duration-[220ms] ease-enter data-[away=true]:-translate-y-full data-[away=true]:duration-[180ms] data-[away=true]:ease-exit",
        "motion-reduce:transition-opacity motion-reduce:duration-100 motion-reduce:data-[away=true]:translate-y-0 motion-reduce:data-[away=true]:opacity-0",
        "lg:data-[away=true]:translate-y-0 lg:data-[away=true]:opacity-100",
      )}
    >
      <div className="mx-auto flex h-12 max-w-5xl items-center gap-2 pr-[max(0.25rem,env(safe-area-inset-right))] pl-[max(0.25rem,env(safe-area-inset-left))] lg:hidden">
        <Button asChild variant="ghost" size="touch" className="px-2 text-[15px]">
          <Link href="/plan"><ChevronLeft className="size-5" /> Plan</Link>
        </Button>
        <p className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold leading-6">{title}</p>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Profile and settings"
          className="grid size-11 shrink-0 touch-manipulation place-items-center rounded-full text-[15px] font-semibold uppercase outline-none transition-colors duration-150 hover:bg-fill focus-visible:ring-2 focus-visible:ring-brand"
        >
          {initial ? <span aria-hidden="true">{initial}</span> : <UserRound className="size-5" aria-hidden="true" />}
        </button>
      </div>
      <div className="mx-auto hidden h-16 max-w-5xl items-center justify-between gap-4 px-6 lg:flex">
        <div className="flex items-center gap-6">
          <Wordmark />
          <AppTabs />
        </div>
        <Button variant="outline" size="icon" aria-label="Settings" onClick={onOpenSettings}><SlidersHorizontal /></Button>
      </div>
    </header>
  );
}
