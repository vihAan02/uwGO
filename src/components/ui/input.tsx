import * as React from "react";
import { cn } from "@/lib/utils";

/** shadcn/ui Input, retokened: 48px tall (thumb-sized), hairline border, brand focus ring. */
export const fieldClass =
  "w-full min-w-0 rounded-xl border border-line bg-surface px-3.5 text-base text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-muted/70 focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-bad aria-invalid:ring-bad/20";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return <input type={type} data-slot="input" className={cn(fieldClass, "h-12", className)} {...props} />;
}

export { Input };
