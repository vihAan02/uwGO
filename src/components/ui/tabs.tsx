"use client";
import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/** shadcn/ui Tabs. The trigger is styled as the app's day chip: quiet at rest, ink when active. */
function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col", className)} {...props} />;
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List data-slot="tabs-list" className={cn("flex gap-1.5", className)} {...props} />;
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "flex min-w-14 flex-1 flex-col items-center justify-center rounded-xl border border-line bg-surface px-2 py-1.5 text-sm font-semibold text-ink outline-none transition-[background-color,color,border-color] duration-150 hover:bg-canvas focus-visible:ring-2 focus-visible:ring-brand data-[state=active]:border-ink data-[state=active]:bg-ink data-[state=active]:text-white data-[state=active]:hover:bg-ink",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("outline-none", className)} {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
