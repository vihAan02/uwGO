"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The app's two places, within reach of a thumb. Phones only: on a wide screen the same two
 * tabs sit in the header (AppTabs), where there is room for them and the thumb is not the issue.
 */
const TABS = [
  { href: "/plan", label: "Plan", Icon: CalendarDays },
  { href: "/courses", label: "Courses", Icon: GraduationCap },
] as const;

/** Height of the bar without the safe area; pages pad their bottom by this so nothing hides under it. */
export const BOTTOM_NAV_PAD = "pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-16";

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-canvas/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <div className="mx-auto flex h-14 max-w-md">
        {TABS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-brand/35",
                active ? "text-ink" : "text-ink-muted hover:text-ink",
              )}
            >
              <Icon className={cn("size-5", active && "stroke-[2.25]")} aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
