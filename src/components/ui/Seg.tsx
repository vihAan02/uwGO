"use client";

export interface SegOption<T extends string | number> {
  value: T;
  label: string;
  /** Second line, smaller. */
  detail?: string;
  /** Marks the one we would pick. */
  starred?: boolean;
  /** Rendered but not choosable — an option that does not fit is shown, not hidden. */
  disabled?: boolean;
  /** Tooltip, usually the reason it does or does not work. */
  title?: string;
}

/**
 * Segmented buttons: exactly one selected. `value` undefined means nothing has been chosen yet,
 * which is a real state here rather than a missing one.
 */
export function Seg<T extends string | number>({
  options, value, onChange, className = "",
}: {
  options: SegOption<T>[];
  value: T | undefined;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={`mt-2 flex flex-wrap gap-2 ${className}`}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          disabled={o.disabled}
          title={o.title}
          aria-pressed={value === o.value}
          className={`btn min-h-11 flex-col items-start gap-0 px-3 py-2 text-sm ${value === o.value ? "btn-primary" : "btn-secondary"} ${o.disabled ? "opacity-50" : ""}`}
          onClick={(e) => { e.stopPropagation(); onChange(o.value); }}
        >
          <span>{o.starred ? `★ ${o.label}` : o.label}</span>
          {o.detail && <span className={`text-xs font-normal ${value === o.value ? "opacity-80" : "text-ink-muted"}`}>{o.detail}</span>}
        </button>
      ))}
    </div>
  );
}
