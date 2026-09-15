import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * shadcn/ui Button (new-york-v4), retokened to UW GO. Same variants as the landing page's
 * copy so the app and the landing read as one product: brand blue means "act", ink means
 * "selected", everything else is quiet. Source: https://ui.shadcn.com/docs/components/button
 */
const buttonVariants = cva(
  "inline-flex shrink-0 touch-manipulation items-center justify-center gap-2 whitespace-nowrap rounded-xl font-medium outline-none transition-[background-color,color,box-shadow,scale,opacity] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-canvas motion-safe:active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-brand text-white hover:bg-[#1e40af] active:bg-[#1e3a8a]",
        outline: "border border-line bg-surface text-ink hover:bg-canvas",
        secondary: "bg-line/60 text-ink hover:bg-line",
        ghost: "text-ink hover:bg-line/60",
        link: "h-auto rounded-none px-0 text-brand underline-offset-4 hover:underline",
        destructive: "border border-line bg-surface text-bad hover:bg-bad-soft",
        inverse: "bg-white text-ink hover:bg-white/90",
        "inverse-soft": "bg-white/15 text-white hover:bg-white/25",
        /** A white control floating on the map: header pills, locate, recenter. DESIGN.md §8. */
        float: "bg-surface text-ink shadow-float hover:bg-canvas",
      },
      size: {
        default: "h-10 px-4 text-sm",
        xs: "h-8 gap-1.5 rounded-lg px-2.5 text-xs",
        sm: "h-9 px-3 text-sm",
        lg: "h-12 px-6 text-base",
        xl: "h-14 px-7 text-[1.0625rem]",
        icon: "size-10",
        "icon-sm": "size-9 rounded-lg",
        /** DESIGN.md §11: 44px for anything a phone user taps, 48px for the primary action. */
        touch: "h-11 px-4 text-[15px]",
        "icon-touch": "size-11",
        primary: "h-12 px-5 text-base font-semibold",
      },
    },
    compoundVariants: [
      // A link reads as text: the size's height, padding and radius must not turn it into a box.
      { variant: "link", class: "h-auto rounded-none px-0 motion-safe:active:scale-100" },
    ],
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
