"use client";
import { addDays, format } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { DayOfWeek, WeekPlan } from "@/domain/types";
import { DAY_LABELS, DAYS_IN_ORDER } from "@/domain/types";
import { formatISODate, torontoDate } from "@/time/toronto";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

const DAY_WORDS: Record<DayOfWeek, string> = { M: "Monday", T: "Tuesday", W: "Wednesday", Th: "Thursday", F: "Friday", S: "Saturday", Su: "Sunday" };

/**
 * Which week and which day the sheet and the map are about. Content controls, not chrome: they live in
 * the sheet under the summary rather than in a header over the map. Each day shows its date, so
 * "tomorrow" is never a guess; a day with no classes is quieter, and today carries a dot.
 */
export function DayStrip({ days, plan, monday, today, isThisWeek, onPrevWeek, onNextWeek, onToday }: {
  days: DayOfWeek[];
  plan: WeekPlan | undefined;
  monday: string;
  today: string;
  isThisWeek: boolean;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
}) {
  const start = torontoDate(monday, 12);
  const friday = addDays(start, 4);
  const range = format(start, "MMM") === format(friday, "MMM") ? `${format(start, "MMM d")}–${format(friday, "d")}` : `${format(start, "MMM d")} – ${format(friday, "MMM d")}`;
  return (
    <div className="px-4 pt-2 sm:px-5 lg:px-0 lg:pt-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="min-w-0 truncate text-[15px] font-semibold leading-5">
          {isThisWeek ? "This week" : "Week"}
          <span className="ml-1.5 font-normal text-ink-muted tabular-nums">{range}</span>
        </h2>
        <div className="-mr-2 flex shrink-0 items-center">
          {!isThisWeek && <Button variant="ghost" size="touch" className="px-3 text-brand" onClick={onToday}>Today</Button>}
          <Button variant="ghost" size="icon-touch" className="rounded-full" aria-label="Previous week" onClick={onPrevWeek}><ChevronLeft className="size-5" /></Button>
          <Button variant="ghost" size="icon-touch" className="rounded-full" aria-label="Next week" onClick={onNextWeek}><ChevronRight className="size-5" /></Button>
        </div>
      </div>
      <TabsList aria-label="Day of the week" className="mt-1 grid auto-cols-fr grid-flow-col gap-1">
        {days.map((d) => {
          const date = addDays(start, DAYS_IN_ORDER.indexOf(d));
          const count = plan?.days[d]?.classes.length ?? 0;
          const isToday = formatISODate(date) === today;
          return (
            <TabsTrigger
              key={d}
              value={d}
              aria-label={`${DAY_WORDS[d]} ${format(date, "MMMM d")}${isToday ? ", today" : ""}, ${count ? `${count} class${count === 1 ? "" : "es"}` : "no classes"}`}
              className={cn(
                "group/day relative h-14 min-w-0 gap-0 rounded-xl border-0 bg-transparent px-1 py-1 text-ink transition-[background-color,color,scale] hover:bg-fill motion-safe:active:scale-[0.97] active:not-data-[state=active]:bg-line/60 data-[state=active]:bg-ink data-[state=active]:text-white",
                !count && "text-ink-muted",
              )}
            >
              <span className="text-[13px] font-medium leading-[18px]">{DAY_LABELS[d]}</span>
              <span className="text-[17px] font-semibold leading-[22px] tabular-nums">{format(date, "d")}</span>
              {isToday && <span aria-hidden="true" className="absolute bottom-1 size-1 rounded-full bg-current" />}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </div>
  );
}
