"use client";
import { ARRIVAL_BUFFER_CHOICES } from "@/domain/config";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function BufferPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <ToggleGroup type="single" value={String(value)} onValueChange={(v) => { if (v) onChange(Number(v)); }} aria-label="Arrival buffer">
      {ARRIVAL_BUFFER_CHOICES.map((b) => (
        <ToggleGroupItem key={b} value={String(b)}>{b} min</ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
