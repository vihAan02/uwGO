"use client";
import { useState } from "react";
import type { DayPlanItem, GapChoice, GapChoiceKind, GymThen } from "@/domain/types";
import { Seg, type SegOption } from "../ui/Seg";

type Gap = Extract<DayPlanItem, { kind: "GAP" }>;

export type ChooseGap = (dateISO: string, classId: string, choice: GapChoice | undefined, everyWeek: boolean) => void;

const PRIMARY: GapChoiceKind[] = ["STAY", "REZ", "GYM", "STUDY"];
const FORK: GymThen[] = ["REZ", "STUDY", "CLASS"];

const same = (a: GapChoice | undefined, b: GapChoice | undefined) =>
  a?.kind === b?.kind && a?.gymThen === b?.gymThen;

/**
 * "What do you want to do after this class?", inline in the gap card.
 *
 * Everything shown is read off the item — the labels, the numbers and the star are all decided
 * by the engine. The only state here is an optimistic echo of the student's own tap: choosing
 * rebuilds the whole week asynchronously, so without it a button would sit unlit until the
 * routes came back.
 */
export function GapChoicePicker({ gap, onChoose }: { gap: Gap; onChoose: ChooseGap }) {
  const planned = gap.choice?.value;
  const plannedWeekly = gap.choice?.source === "CLASS";
  // Adjusting state to a changed prop during render, rather than in an effect: React re-runs
  // this component before painting, so the button never flashes the stale answer.
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

  const primary: SegOption<GapChoiceKind>[] = PRIMARY.flatMap((kind) => {
    const o = optionFor(kind, undefined);
    return o ? [{ value: kind, label: o.label, detail: o.detail, starred: o.starred, disabled: !o.fits, title: o.reason }] : [];
  });
  if (primary.length < 2) return null;

  const fork: SegOption<GymThen>[] = pending?.kind !== "GYM" ? [] : FORK.flatMap((then) => {
    const o = optionFor("GYM", then);
    return o ? [{ value: then, label: o.label, detail: o.detail, starred: o.starred, disabled: !o.fits, title: o.reason }] : [];
  });

  return (
    <div className="mt-3 border-t border-line pt-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">After this class</div>
      <Seg
        options={primary}
        value={pending?.kind}
        onChange={(kind) => commit({ kind })}
      />

      {fork.length > 0 && (
        <div className="mt-3 border-l-2 border-line pl-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Then</div>
          <Seg
            options={fork}
            value={pending?.gymThen}
            onChange={(gymThen) => commit({ kind: "GYM", gymThen })}
          />
        </div>
      )}

      {pending && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <label className="flex min-h-11 items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              className="size-4"
              checked={everyWeek}
              onChange={(e) => { e.stopPropagation(); commit(pending, e.target.checked); }}
            />
            Do this every week
          </label>
          <button
            type="button"
            className="btn btn-ghost min-h-9 px-3 text-xs"
            onClick={(e) => { e.stopPropagation(); commit(undefined, false); }}
          >
            Clear
          </button>
        </div>
      )}

      {gap.recommendation && !pending && (
        <p className="mt-2 text-xs text-ink-muted">★ {gap.recommendation.reason}</p>
      )}
    </div>
  );
}
