"use client";
import { ARRIVAL_BUFFER_CHOICES } from "@/domain/config";

export function BufferPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="mt-3 flex gap-2">
      {ARRIVAL_BUFFER_CHOICES.map((b) => (
        <button key={b} className={`btn flex-1 ${value === b ? "btn-primary" : "btn-secondary"}`} onClick={() => onChange(b)}>{b} min</button>
      ))}
    </div>
  );
}
