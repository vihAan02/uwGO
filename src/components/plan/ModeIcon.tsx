import { Building2, Bus, Footprints } from "lucide-react";
import type { RouteOption } from "@/domain/types";
import { cn } from "@/lib/utils";

/** One small icon per way of moving: indoors, bus, or on foot. Replaces the emoji the app used to print. */
export function ModeIcon({ route, className }: { route: RouteOption | undefined; className?: string }) {
  const cls = cn("size-4 shrink-0", className);
  if (route?.indoorPath) return <Building2 className={cls} aria-label="Indoors" />;
  if (route?.mode === "TRANSIT") return <Bus className={cls} aria-label="Bus" />;
  return <Footprints className={cls} aria-label="Walk" />;
}
