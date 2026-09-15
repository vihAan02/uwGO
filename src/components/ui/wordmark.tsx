import Link from "next/link";
import { cn } from "@/lib/utils";

/** The same wordmark the landing page uses, so the app reads as the same product. */
export function Wordmark({ href = "/plan", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("rounded-md text-base font-semibold tracking-[-0.02em] text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand", className)}>
      UW GO
    </Link>
  );
}
