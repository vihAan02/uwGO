import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * shadcn/ui Skeleton, retokened to UW GO: a quiet fill where content has never existed yet, never
 * over content that is only refreshing. Pulses only when motion is welcome (DESIGN.md §17).
 * Source: https://ui.shadcn.com/docs/components/radix/skeleton
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" aria-hidden="true" className={cn("rounded-lg bg-fill motion-safe:animate-pulse", className)} {...props} />;
}

export { Skeleton };
