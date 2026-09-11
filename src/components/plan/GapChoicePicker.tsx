"use client";
import { useState } from "react";
import type { DayPlanItem, GapChoice, GapChoiceKind, GymThen } from "@/domain/types";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Gap = Extract<DayPlanItem, { kind: "GAP" }>;

export type ChooseGap = (dateISO: string, classId: string, choice: GapChoice | undefined, everyWeek: boolean) => void;

const PRIMARY: GapChoiceKind[] = ["STAY", "REZ", "GYM", "STUDY"];
const FORK: GymThen[] = ["REZ", "STUDY", "CLASS"];

const same = (a: GapChoice | undefined, b: GapChoice | undefined) =>
  a?.kind === b?.kind && a?.gymThen === b?.gymThen;

interface Option<T extends string> { value: T; label: string; detail?: string; starred?: boolean; disabled?: boolean; title?: string }

function Options<T extends string>({ options, value, onChange, label }: { options: Option<T>[]; value: T | undefined; onChange: (v: T) => void; label: string }) {
  return (
    <ToggleGroup type="single" layout="stacked" className="mt-2" value={value ?? ""} onValueChange={(v) => { if (v) onChange(v as T); }} aria-label={label}>
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} disabled={o.disabled} title={o.title} className="min-w-[7.5rem] flex-none">
          <span className="flex items-center gap-1.5">
            {o.label}
            {o.starred && <Badge variant="brand" className="px-1.5 py-0 text-[10px] leading-4">Best</Badge>}
          </span>
          {o.detail && <span className="text-xs font-normal opacity-70">{o.detail}</span>}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/**
 * "What do you want to do after this class?", inline in the gap row.
 *
 * Everything shown is read off the item — the labels, the numbers and which option is best
 * are all decided by the engine. The only state here is an optimistic echo of the student's own
 * tap: choosing rebuilds the whole week asynchronously, so without it a chip would sit unlit
 * until the routes came back.
 */
export function GapChoicePicker({ gap, onChoose }: { gap: Gap; onChoose: ChooseGap }) {
  const planned = gap.choice?.value;
  const plannedWeekly = gap.choice?.source === "CLASS";
  // Adjusting state to a changed prop during render, rather than in an effect: React re-runs
  // this component before painting, so the chip never flashes the stale answer.
  const [echo, setEcho] = useState({ seen: planned, value: planned, everyWeek: plannedWeekly });
  if (!same(echo.seen, planned)) setEcho({ seen: planned, value: planned, everyWeek: plannedWeekly });

  const pending = echo.value;
  const everyWeek = echo.everyWeek;

  const optionFor = (kind: GapChoiceKind, gymThen?: GymThen) =>
    gap.options.find((o) => o.kind === kind && o.gymThen === gymThen);

  const commit = (choice: GapChoice | undefined, weekly = everyWeek) => {
    setEcho({ seen: planned, value: choice, everyWeek: weekly });
    onChoose(gap.dateISO, gap.classId, choice, weekly);
  };

  const primary: Option<GapChoiceKind>[] = PRIMARY.flatMap((kind) => {
    const o = optionFor(kind, undefined);
    return o ? [{ value: kind, label: o.label, detail: o.detail, starred: o.starred, disabled: !o.fits, title: o.reason }] : [];
  });
  if (primary.length < 2) return null;

  const fork: Option<GymThen>[] = pending?.kind !== "GYM" ? [] : FORK.flatMap((then) => {
    const o = optionFor("GYM", then);
    return o ? [{ value: then, label: o.label, detail: o.detail, starred: o.starred, disabled: !o.fits, title: o.reason }] : [];
  });

  const weeklyId = `weekly-${gap.dateISO}-${gap.classId}`;

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">After this class</div>
      <Options options={primary} value={pending?.kind} onChange={(kind) => commit({ kind })} label="After this class" />

      {fork.length > 0 && (
        <div className="mt-3 border-l-2 border-line pl-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Then</div>
          <Options options={fork} value={pending?.gymThen} onChange={(gymThen) => commit({ kind: "GYM", gymThen })} label="Then" />
        </div>
      )}

      {pending && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={weeklyId} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm text-ink-muted">
            <Checkbox id={weeklyId} checked={everyWeek} onCheckedChange={(c) => commit(pending, c === true)} onClick={(e) => e.stopPropagation()} />
            Do this every week
          </label>
          <Button type="button" variant="ghost" size="xs" className="text-ink-muted" onClick={(e) => { e.stopPropagation(); commit(undefined, false); }}>
            Clear
          </Button>
        </div>
      )}

      {gap.recommendation && !pending && (
        <p className="mt-2 text-xs text-ink-muted">{gap.recommendation.reason}</p>
      )}
    </div>
  );
}
