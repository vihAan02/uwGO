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
  "inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink outline-none transition-[background-color,color,border-color,box-shadow] duration-150 hover:bg-canvas focus-visible:z-10 focus-visible:ring-[3px] focus-visible:ring-brand/35 disabled:pointer-events-none disabled:opacity-45 data-[state=on]:border-ink data-[state=on]:bg-ink data-[state=on]:text-white data-[state=on]:hover:bg-ink [&_svg]:size-4 [&_svg]:shrink-0",
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

export { ToggleGroup, ToggleGroupItem, toggleItemVariants };
