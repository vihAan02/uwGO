"use client";
import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { DayPlanItem, GapChoice, GapChoiceKind, GymThen } from "@/domain/types";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

type Gap = Extract<DayPlanItem, { kind: "GAP" }>;

export type ChooseGap = (dateISO: string, classId: string, choice: GapChoice | undefined, everyWeek: boolean) => void;

const PRIMARY: GapChoiceKind[] = ["STAY", "REZ", "GYM", "STUDY"];
const FORK: GymThen[] = ["REZ", "STUDY", "CLASS"];

const same = (a: GapChoice | undefined, b: GapChoice | undefined) =>
  a?.kind === b?.kind && a?.gymThen === b?.gymThen;

interface Option<T extends string> { value: T; label: string; detail?: string; starred?: boolean; disabled?: boolean; reason?: string }

/** A chosen option is ringed in ink on a quiet fill; one that does not fit stays visible and says why, in words. */
const OPTION = "w-full min-w-0 rounded-xl px-3 py-2 data-[state=on]:border-ink data-[state=on]:bg-fill data-[state=on]:text-ink data-[state=on]:shadow-[inset_0_0_0_1px_var(--color-ink)] data-[state=on]:hover:bg-fill disabled:border-dashed disabled:opacity-100 sm:w-auto sm:min-w-[8.5rem]";

function Options<T extends string>({ options, value, onChange, label }: { options: Option<T>[]; value: T | undefined; onChange: (v: T) => void; label: string }) {
  return (
    <ToggleGroup type="single" layout="stacked" className="mt-2 grid grid-cols-2 gap-2 sm:flex" value={value ?? ""} onValueChange={(v) => { if (v) onChange(v as T); }} aria-label={label}>
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} disabled={o.disabled} className={OPTION}>
          <span className="flex w-full items-baseline justify-between gap-1.5 text-[14px] font-medium leading-5">
            {o.label}
            {o.starred && <span className="text-[12px] font-semibold text-ok">Best</span>}
          </span>
          {(o.disabled ? o.reason : o.detail) && (
            <span className="text-[12px] font-normal leading-4 text-ink-muted">{o.disabled ? o.reason : o.detail}</span>
          )}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/**
 * "What do you want to do after this class?", disclosed only when the student asks: the row says what
 * the engine would pick (or what was picked) and one tap opens the choices.
 *
 * Everything shown is read off the item — the labels, the numbers and which option is best are all
 * decided by the engine. The only state here is an optimistic echo of the student's own tap, and
 * whether the choices are open: choosing rebuilds the whole week asynchronously, so without the echo a
 * chip would sit unlit until the routes came back.
 */
export function GapChoicePicker({ gap, onChoose }: { gap: Gap; onChoose: ChooseGap }) {
  const planned = gap.choice?.value;
  const plannedWeekly = gap.choice?.source === "CLASS";
  // Adjusting state to a changed prop during render, rather than in an effect: React re-runs
  // this component before painting, so the chip never flashes the stale answer.
  const [echo, setEcho] = useState({ seen: planned, value: planned, everyWeek: plannedWeekly });
  if (!same(echo.seen, planned)) setEcho({ seen: planned, value: planned, everyWeek: plannedWeekly });
  const [open, setOpen] = useState(false);
  // Opening swaps the Choose button for the choices, and Done or Clear removes the control that was
  // pressed: focus follows to where the student is looking, never back to the top of the page.
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const refocus = useRef<"choices" | "toggle" | undefined>(undefined);
  useEffect(() => {
    const target = refocus.current;
    if (!target) return;
    refocus.current = undefined;
    if (target === "toggle") { toggleRef.current?.focus(); return; }
    const panel = panelRef.current;
    (panel?.querySelector<HTMLElement>("[data-slot=toggle-group-item][data-state=on]") ?? panel?.querySelector<HTMLElement>("[data-slot=toggle-group-item]:not(:disabled)"))?.focus();
  });
  const show = (next: boolean) => { refocus.current = next ? "choices" : "toggle"; setOpen(next); };

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
    return o ? [{ value: kind, label: o.label, detail: o.detail, starred: o.starred, disabled: !o.fits, reason: o.reason }] : [];
  });
  if (primary.length < 2) return null;

  const fork: Option<GymThen>[] = pending?.kind !== "GYM" ? [] : FORK.flatMap((then) => {
    const o = optionFor("GYM", then);
    return o ? [{ value: then, label: o.label, detail: o.detail, starred: o.starred, disabled: !o.fits, reason: o.reason }] : [];
  });

  const chosen = pending ? optionFor(pending.kind, pending.gymThen) ?? optionFor(pending.kind, undefined) : undefined;
  const best = gap.options.find((o) => o.starred);
  const weeklyId = `weekly-${gap.dateISO}-${gap.classId}`;

  if (!open) {
    const shown = chosen ?? best;
    return (
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="min-w-0 text-[13px] leading-[18px]">
          {shown ? (
            <>
              {chosen ? <Check className="mr-1 inline size-3.5 align-[-2px] text-ink" aria-label="Chosen" /> : <span className="text-ink-muted">Best: </span>}
              <span className="font-medium text-ink">{shown.label}</span>
              {shown.detail && <span className="text-ink-muted"> · {shown.detail}</span>}
            </>
          ) : (
            <span className="text-ink-muted">What will you do with this time?</span>
          )}
        </p>
        <Button ref={toggleRef} type="button" variant="outline" size="touch" className="shrink-0 rounded-full px-4" aria-expanded={false} onClick={() => show(true)}>
          {chosen ? "Change" : "Choose"}
        </Button>
      </div>
    );
  }

  return (
    // Open, the choices take the row's whole width back from the time rail beside them.
    <div ref={panelRef} className="-ml-[76px] mt-3 sm:-ml-[88px]">
      <p className="text-[13px] font-medium leading-[18px]">After this class</p>
      <Options options={primary} value={pending?.kind} onChange={(kind) => commit({ kind })} label="After this class" />

      {fork.length > 0 && (
        <div className="mt-3">
          <p className="text-[13px] font-medium leading-[18px]">Then</p>
          <Options options={fork} value={pending?.gymThen} onChange={(gymThen) => commit({ kind: "GYM", gymThen })} label="Then" />
        </div>
      )}

      {gap.recommendation && !pending && (
        <p className="mt-2 text-[13px] leading-[18px] text-ink-muted">{gap.recommendation.reason}</p>
      )}

      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3">
        {pending ? (
          <label htmlFor={weeklyId} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[14px]">
            <Checkbox id={weeklyId} checked={everyWeek} onCheckedChange={(c) => commit(pending, c === true)} />
            Do this every week
          </label>
        ) : <span />}
        <div className="-mr-2 flex items-center">
          {pending && <Button type="button" variant="ghost" size="touch" className="text-ink-muted" onClick={() => { refocus.current = "choices"; commit(undefined, false); }}>Clear</Button>}
          <Button type="button" variant="ghost" size="touch" aria-expanded onClick={() => show(false)}>Done</Button>
        </div>
      </div>
    </div>
  );
}
