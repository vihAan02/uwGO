"use client";
import * as React from "react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * shadcn/ui Sheet. Slides up from the bottom on phones and in from the right on wider
 * screens; the keyframes live in globals.css and only run when motion is welcome. Radix
 * waits for the CSS exit animation before unmounting, which is why the transitions are
 * CSS rather than Anime.js here.
 */
const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

function SheetOverlay({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-40 bg-ink/40 motion-safe:data-[state=open]:animate-[fade-in_200ms_ease-out] motion-safe:data-[state=closed]:animate-[fade-out_160ms_ease-in]",
        className,
      )}
      {...props}
    />
  );
}

function SheetContent({ className, children, ...props }: React.ComponentProps<typeof SheetPrimitive.Content>) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "fixed z-50 flex flex-col bg-surface text-ink shadow-[0_-8px_40px_-12px_rgb(15_23_42/0.25)] outline-none",
          "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-3xl",
          "sm:inset-y-0 sm:right-0 sm:left-auto sm:h-full sm:max-h-none sm:w-[26rem] sm:rounded-none sm:border-l sm:border-line sm:shadow-[-8px_0_40px_-12px_rgb(15_23_42/0.2)]",
          "motion-safe:data-[state=open]:animate-[sheet-in-bottom_260ms_cubic-bezier(0.2,0.8,0.2,1)] motion-safe:data-[state=closed]:animate-[sheet-out-bottom_180ms_ease-in]",
          "sm:motion-safe:data-[state=open]:animate-[sheet-in-right_260ms_cubic-bezier(0.2,0.8,0.2,1)] sm:motion-safe:data-[state=closed]:animate-[sheet-out-right_180ms_ease-in]",
          className,
        )}
        {...props}
      >
        {children}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="sheet-header" className={cn("flex items-center justify-between gap-3 border-b border-line px-4 pt-3 pb-2 sm:px-5 sm:pt-4", className)} {...props}>
      {children}
      <SheetPrimitive.Close asChild>
        <Button variant="ghost" size="icon-touch" className="-mr-2 rounded-full" aria-label="Close">
          <X className="size-5" />
        </Button>
      </SheetPrimitive.Close>
    </div>
  );
}

function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-body" className={cn("min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-5", className)} {...props} />;
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title data-slot="sheet-title" className={cn("text-lg font-semibold tracking-[-0.01em] text-ink", className)} {...props} />;
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description data-slot="sheet-description" className={cn("text-sm text-ink-muted", className)} {...props} />;
}

export { Sheet, SheetTrigger, SheetClose, SheetPortal, SheetOverlay, SheetContent, SheetHeader, SheetBody, SheetTitle, SheetDescription };
