"use client";
import * as React from "react";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * shadcn/ui Toggle Group as UW GO's segmented control: a row of quiet chips, the chosen
 * one in ink. Replaces the old `Seg` and the ad-hoc btn-primary/btn-secondary pairs.
 */
const toggleItemVariants = cva(
  "inline-flex min-h-11 flex-1 touch-manipulation items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink outline-none transition-[background-color,color,border-color,box-shadow,scale] duration-150 hover:bg-canvas focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-brand motion-safe:active:scale-[0.97] active:not-data-[state=on]:bg-fill disabled:pointer-events-none disabled:opacity-45 data-[state=on]:border-ink data-[state=on]:bg-ink data-[state=on]:text-white data-[state=on]:hover:bg-ink [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      layout: {
        row: "whitespace-nowrap",
        stacked: "flex-col items-start gap-0 px-3 py-2 text-left",
      },
    },
    defaultVariants: { layout: "row" },
  },
);

const Ctx = React.createContext<VariantProps<typeof toggleItemVariants>>({ layout: "row" });

function ToggleGroup({ className, layout, children, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Root> & VariantProps<typeof toggleItemVariants>) {
  return (
    <ToggleGroupPrimitive.Root data-slot="toggle-group" className={cn("flex flex-wrap gap-2", className)} {...props}>
      <Ctx.Provider value={{ layout }}>{children}</Ctx.Provider>
    </ToggleGroupPrimitive.Root>
  );
}

function ToggleGroupItem({ className, children, layout, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Item> & VariantProps<typeof toggleItemVariants>) {
  const ctx = React.useContext(Ctx);
  return (
    <ToggleGroupPrimitive.Item data-slot="toggle-group-item" className={cn(toggleItemVariants({ layout: layout ?? ctx.layout }), className)} {...props}>
      {children}
    </ToggleGroupPrimitive.Item>
  );
}

/**
 * A segmented control on the same primitive: a quiet track with the chosen segment lifted to white,
 * ink on surface rather than a coloured fill (DESIGN.md §7). Every label stays ink: the muted grey on the
 * grey track would fall under the contrast DESIGN.md §18 asks for. Single choice only, and pressing the
 * chosen segment again keeps it chosen: Radix reports "" for that, which would otherwise leave nothing
 * selected (and, for a route, nothing on the map).
 */
function SegmentedControl({ value, onValueChange, label, className, children }: {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      data-slot="segmented-control"
      value={value}
      onValueChange={(v) => { if (v) onValueChange(v); }}
      aria-label={label}
      className={cn("grid auto-cols-fr grid-flow-col gap-0.5 rounded-xl bg-fill p-0.5", className)}
    >
      {children}
    </ToggleGroupPrimitive.Root>
  );
}

function SegmentedItem({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="segmented-item"
      className={cn(
        "flex min-h-11 min-w-0 touch-manipulation flex-col items-center justify-center rounded-[10px] px-2 py-1 text-ink outline-none transition-[background-color,color,box-shadow,scale] duration-150 ease-standard focus-visible:ring-2 focus-visible:ring-brand motion-safe:active:scale-[0.97] active:not-data-[state=on]:bg-surface/60 disabled:pointer-events-none disabled:opacity-45 data-[state=on]:bg-surface data-[state=on]:text-ink data-[state=on]:shadow-[0_1px_2px_rgb(15_23_42/0.12),0_0_0_0.5px_rgb(15_23_42/0.04)]",
        className,
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem, toggleItemVariants, SegmentedControl, SegmentedItem };
