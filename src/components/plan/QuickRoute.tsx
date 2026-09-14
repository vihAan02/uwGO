"use client";
import { useRef, useState } from "react";
import type { LatLng, RoutePreference, UserHome } from "@/domain/types";
import { rerouteFrom } from "@/lib/tripRoute";
import { QUICK_DESTINATIONS, QUICK_LABELS, planQuickRoute, type QuickDestination } from "@/lib/quickRoute";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toggleItemVariants } from "@/components/ui/toggle-group";
import type { MapSelection } from "../map/MapPanel";

export const quickRouteId = (dest: QuickDestination) => `quick-${dest.toLowerCase()}`;

/** Where the student is, asked for when a quick route is tapped: a fix up to half a minute old is fine to route from. */
function currentPosition(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      reject({ code: 2 });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      reject,
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 },
    );
  });
}

/**
 * Quick routes: from where the student is right now to home, the gym or the nearest open library, whatever the
 * time and whatever the day's plan says. The route goes on the map like any leg, so Start trip takes it from there.
 */
export function QuickRoute({ home, preference, closedEdgeIds, selectedId, onRoute, onSetHome }: {
  home: UserHome | undefined;
  preference: RoutePreference;
  closedEdgeIds?: ReadonlySet<string>;
  selectedId: string | undefined;
  onRoute: (id: string, selection: MapSelection) => void;
  onSetHome: () => void;
}) {
  const [busy, setBusy] = useState<QuickDestination | undefined>();
  const [message, setMessage] = useState<{ text: string; setHome?: boolean } | undefined>();
  // Only the latest tap may answer: a slow first lookup must not replace the route the student asked for since.
  const latest = useRef(0);

  const go = async (dest: QuickDestination) => {
    const request = ++latest.current;
    setBusy(dest);
    setMessage(undefined);
    const result = await planQuickRoute(dest, {
      home,
      position: currentPosition,
      route: (at, to, now) => rerouteFrom(at, to, preference, now, closedEdgeIds),
    });
    if (request !== latest.current) return;
    setBusy(undefined);
    if (result.kind === "ROUTE") {
      onRoute(quickRouteId(dest), { kind: "LEG", label: `Your location → ${result.to.name}`, from: result.from, to: result.to, route: result.route });
      setMessage(result.note ? { text: result.note } : undefined);
    } else {
      setMessage({ text: result.message, setHome: result.kind === "PROBLEM" && result.action === "SET_HOME" });
    }
  };

  return (
    <section className="mt-3 border-t border-line px-1 pt-3" aria-labelledby="quick-route-title">
      <h2 id="quick-route-title" className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Quick route</h2>
      <p className="mt-0.5 text-sm text-ink-muted">From where you are, right now.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {QUICK_DESTINATIONS.map((dest) => {
          const shown = selectedId === quickRouteId(dest);
          return (
            <button
              key={dest}
              type="button"
              aria-pressed={shown}
              data-state={shown ? "on" : "off"}
              aria-busy={busy === dest}
              className={cn(toggleItemVariants(), "min-w-[5.5rem] flex-none")}
              onClick={() => void go(dest)}
            >
              {busy === dest && <span aria-hidden="true" className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
              {QUICK_LABELS[dest]}
            </button>
          );
        })}
      </div>
      <div role="status" aria-live="polite" className="mt-2 flex min-h-5 flex-wrap items-center gap-x-2 text-sm text-ink-muted empty:hidden">
        {busy ? "Finding the way from where you are…" : message?.text}
        {!busy && message?.setHome && <Button variant="link" size="xs" onClick={onSetHome}>Set home</Button>}
      </div>
    </section>
  );
}
