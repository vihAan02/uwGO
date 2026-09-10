import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../_lib/utils";

/**
 * shadcn/ui Button (new-york-v4), adapted for the UW GO landing page.
 * Source: https://ui.shadcn.com/docs/components/button
 *
 * Changes from upstream: colour tokens map to the app's existing theme (brand, ink, line,
 * canvas, surface) instead of shadcn's --primary/--accent variables, so nothing in the shared
 * globals has to change; radius is the app's 0.75rem; the Slot/asChild path is dropped in
 * favour of shadcn's documented `buttonVariants()` on a Next `Link`.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl font-medium outline-none transition-[background-color,color,box-shadow,transform] duration-150 ease-out focus-visible:ring-[3px] focus-visible:ring-brand/35 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-brand text-white hover:bg-[#1e40af] active:bg-[#1e3a8a]",
        outline: "border border-line bg-surface text-ink hover:bg-canvas active:bg-line/60",
        ghost: "text-ink hover:bg-canvas",
        link: "text-brand underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 text-sm",
        sm: "h-9 px-3.5 text-sm",
        lg: "h-12 px-6 text-base",
        xl: "h-14 px-7 text-[1.0625rem]",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return (
    <button
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
