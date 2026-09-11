import type { LatLng, RouteOption } from "@/domain/types";
import { pairKey, type RoutingProvider, type TransitOptions } from "./RoutingProvider";

/** Google Maps Platform Service Specific Terms §19.3: Routes API results may be cached for at most 30 consecutive days. */
export const WALK_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Transit itineraries are time-dependent; keep them only briefly. */
export const TRANSIT_CACHE_TTL_MS = 10 * 60 * 1000;

interface Entry { route: RouteOption | undefined; expiresAt: number }

export interface RouteCacheStore {
  get(key: string): Entry | undefined;
  set(key: string, entry: Entry): void;
}

export class MemoryRouteCacheStore implements RouteCacheStore {
  private readonly map = new Map<string, Entry>();
  get(key: string) { return this.map.get(key); }
  set(key: string, entry: Entry) { this.map.set(key, entry); }
  get size() { return this.map.size; }
}

export class CachedRoutingProvider implements RoutingProvider {
  readonly id: string;
  private readonly inflight = new Map<string, Promise<RouteOption | undefined>>();

  constructor(
    private readonly inner: RoutingProvider,
    private readonly store: RouteCacheStore = new MemoryRouteCacheStore(),
    private readonly now: () => number = () => Date.now(),
    private readonly ttl = { walk: WALK_CACHE_TTL_MS, transit: TRANSIT_CACHE_TTL_MS },
  ) {
    this.id = `cached(${inner.id})`;
  }

  private async through(key: string, ttlMs: number, compute: () => Promise<RouteOption | undefined>): Promise<RouteOption | undefined> {
    const hit = this.store.get(key);
    // An estimate only ever stands in for a routing provider that was not configured when it was
    // made. Serving it from the cache would outlive that: a browser that planned once against a
    // server without a key kept showing straight-line times for those pairs for 30 days.
    if (hit && hit.expiresAt > this.now() && !hit.route?.isEstimate) return hit.route;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = compute()
      .then((route) => {
        // Only cache real routes; a failed call or an estimate should be asked for again next time.
        if (route && !route.isEstimate) this.store.set(key, { route, expiresAt: this.now() + ttlMs });
        return route;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  getWalkingRoute(from: LatLng, to: LatLng) {
    return this.through(`WALK|${pairKey(from, to)}`, this.ttl.walk, () => this.inner.getWalkingRoute(from, to));
  }

  getTransitRoute(from: LatLng, to: LatLng, opts: TransitOptions) {
    const t = opts.arrivalTime ? `A${Math.floor(opts.arrivalTime.getTime() / 60000)}` : `D${Math.floor((opts.departureTime?.getTime() ?? 0) / 60000)}`;
    return this.through(`TRANSIT|${pairKey(from, to)}|${t}`, this.ttl.transit, () => this.inner.getTransitRoute(from, to, opts));
  }
}
