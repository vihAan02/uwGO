import * as React from "react";
import { cn } from "@/lib/utils";
import { fieldClass } from "./input";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(fieldClass, "min-h-32 py-3 leading-relaxed", className)} {...props} />;
}

export { Textarea };
