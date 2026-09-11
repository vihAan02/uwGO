import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { fieldClass } from "./input";

/**
 * shadcn/ui Native Select. The system picker is the better control on a phone for long
 * lists (a hundred buildings), which is where this app is mostly used.
 */
function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select data-slot="native-select" className={cn(fieldClass, "h-12 appearance-none pr-10", className)} {...props}>
        {children}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-ink-muted" />
    </div>
  );
}

function NativeSelectOption(props: React.ComponentProps<"option">) {
  return <option {...props} />;
}

export { NativeSelect, NativeSelectOption };
