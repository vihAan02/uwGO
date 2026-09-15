"use client";
import type { RouteChoice, RouteChoiceKey } from "@/lib/routeChoices";
import { formatDuration } from "@/time/toronto";
import { SegmentedControl, SegmentedItem } from "@/components/ui/toggle-group";
import { ModeIcon } from "./ModeIcon";

/**
 * The ways to make one leg, when there is more than one worth taking: "Best · 8 min", "Indoors ·
 * 10 min", "Walk · 25 min". Nothing here decides anything; the choices come from `routeChoices` and a
 * tap only says which one the map should draw and Start should take. Absent for a leg with one way.
 */
export function RouteChoices({ choices, selected, onChoose, className }: {
  choices: readonly RouteChoice[];
  selected: RouteChoiceKey;
  onChoose: (key: RouteChoiceKey) => void;
  className?: string;
}) {
  if (choices.length < 2) return null;
  return (
    <SegmentedControl value={selected} onValueChange={(v) => onChoose(v as RouteChoiceKey)} label="Ways to go" className={className}>
      {choices.map((c) => (
        <SegmentedItem key={c.key} value={c.key} aria-label={`${c.label}, ${formatDuration(c.route.durationMinutes)}`}>
          <span className="flex max-w-full items-center gap-1.5 text-[14px] font-medium leading-5">
            <ModeIcon route={c.route} className="size-4" />
            <span className="truncate">{c.label}</span>
          </span>
          <span className="text-[13px] leading-[18px] text-ink/70 tabular-nums">{formatDuration(c.route.durationMinutes)}</span>
        </SegmentedItem>
      ))}
    </SegmentedControl>
  );
}
