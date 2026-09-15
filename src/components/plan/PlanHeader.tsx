"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { GraduationCap, SlidersHorizontal, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/ui/wordmark";
import { AppTabs } from "@/components/nav/AppTabs";

const PILL = "pointer-events-auto flex h-11 touch-manipulation items-center rounded-full bg-surface text-ink shadow-float outline-none transition-[background-color,scale] duration-150 hover:bg-canvas focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-safe:active:scale-[0.97] group-data-[away=true]/header:pointer-events-none";

/**
 * The planner's header (DESIGN.md §13). On a phone: small opaque pills floating over the map, the
 * wordmark on the left, Courses and the profile on the right, stepping out of the way while the student
 * reads the day and never while one of them holds focus. On a wide screen: an ordinary header row. One
 * element for both, so crossing the breakpoint remounts nothing.
 */
export function PlanHeader({ hidden, onOpenSettings, initial, onHeight, className }: {
  hidden: boolean;
  onOpenSettings: () => void;
  /** The first letter of the student's email, for the profile button. */
  initial?: string;
  /** The header's height on a phone, safe area included, for framing the map under it. */
  onHeight?: (px: number) => void;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [focused, setFocused] = useState(false);
  const away = hidden && !focused;
  const heightRef = useRef(onHeight);
  useEffect(() => { heightRef.current = onHeight; });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => heightRef.current?.(Math.round(el.getBoundingClientRect().height));
    const ro = new ResizeObserver(report);
    ro.observe(el);
    report();
    return () => ro.disconnect();
  }, []);

  return (
    <header
      ref={ref}
      data-away={away}
      onFocus={() => setFocused(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}
      className={cn(
        "group/header pointer-events-none fixed inset-x-0 top-0 z-30 pt-[calc(env(safe-area-inset-top)+0.5rem)] pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))]",
        // Tailwind's translate utilities set `translate`, so that is the property to transition. Stepped away, the
        // controls stay in the tab order (never `visibility: hidden`): focusing one is what brings the header back.
        "transition-[translate,opacity] duration-[220ms] ease-enter data-[away=true]:-translate-y-[calc(100%+0.5rem)] data-[away=true]:duration-[180ms] data-[away=true]:ease-exit",
        "motion-reduce:transition-opacity motion-reduce:duration-100 motion-reduce:data-[away=true]:translate-y-0 motion-reduce:data-[away=true]:opacity-0",
        "lg:pointer-events-auto lg:sticky lg:border-b lg:border-line lg:bg-canvas lg:px-6 lg:pt-0 lg:data-[away=true]:translate-y-0 lg:data-[away=true]:opacity-100",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2 lg:hidden">
        <Link href="/plan" className={cn(PILL, "px-4 text-[15px] font-semibold tracking-[-0.02em]")}>UW GO</Link>
        <nav aria-label="Sections" className="flex items-center gap-2">
          <Link href="/courses" className={cn(PILL, "gap-1.5 px-3.5 text-[14px] font-medium")}>
            <GraduationCap className="size-[18px]" aria-hidden="true" />
            Courses
          </Link>
          <button type="button" onClick={onOpenSettings} aria-label="Profile and settings" className={cn(PILL, "size-11 justify-center text-[15px] font-semibold uppercase")}>
            {initial ? <span aria-hidden="true">{initial}</span> : <UserRound className="size-5" aria-hidden="true" />}
          </button>
        </nav>
      </div>
      <div className="mx-auto hidden h-16 max-w-6xl items-center justify-between gap-4 lg:flex">
        <div className="flex items-center gap-6">
          <Wordmark />
          <AppTabs />
        </div>
        <Button variant="outline" size="icon" aria-label="Settings" onClick={onOpenSettings}><SlidersHorizontal /></Button>
      </div>
    </header>
  );
}
