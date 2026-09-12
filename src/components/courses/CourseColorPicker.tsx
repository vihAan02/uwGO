"use client";
import { Check } from "lucide-react";
import { COURSE_COLORS, type CourseColorId } from "@/lib/courseColors";

/**
 * The course colour palette. A fixed set rather than a free picker, so every choice keeps the
 * timetable readable; the chosen swatch carries a check and a ring, never colour alone.
 */
export function CourseColorPicker({ value, onChange, courseLabel }: { value: CourseColorId | undefined; onChange: (color: CourseColorId) => void; courseLabel: string }) {
  return (
    <div role="group" aria-label={`Colour for ${courseLabel}`} className="flex flex-wrap gap-2">
      {COURSE_COLORS.map((c) => {
        const on = value === c.id;
        return (
          <button
            key={c.id}
            type="button"
            title={c.name}
            aria-label={c.name}
            aria-pressed={on}
            onClick={() => onChange(c.id)}
            className="grid size-7 place-items-center rounded-full outline-none ring-offset-2 ring-offset-surface transition-transform duration-150 hover:scale-110 focus-visible:ring-2 focus-visible:ring-brand/60 aria-pressed:ring-2 aria-pressed:ring-ink motion-reduce:transition-none motion-reduce:hover:scale-100"
            style={{ backgroundColor: c.rail }}
          >
            {on && <Check className="size-4 text-white" strokeWidth={3} aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}
