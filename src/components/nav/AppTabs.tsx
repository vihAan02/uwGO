"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The app's two places: the day's plan, and the student's courses. Styled as the day chips
 * already are, so this reads as part of the same header rather than a new piece of furniture.
 */
const TABS = [
  { href: "/plan", label: "Plan", Icon: CalendarDays },
  { href: "/courses", label: "Courses", Icon: GraduationCap },
] as const;

export function AppTabs({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections" className={cn("flex gap-1.5", className)}>
      {TABS.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-semibold outline-none transition-[background-color,color,border-color] duration-150 focus-visible:ring-2 focus-visible:ring-brand",
              active ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink hover:bg-canvas",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
