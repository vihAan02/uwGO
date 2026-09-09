import type { RouteOption } from "@/domain/types";
import type { RouteCacheStore } from "@/routing/CachedRoutingProvider";
import { deserializeRoute, serializeRoute, type RouteOptionJSON } from "@/routing/serialize";

const KEY = "uwgo.routes.v1";
const MAX_ENTRIES = 400;

interface Persisted { [key: string]: { route: RouteOptionJSON; expiresAt: number } }

/**
 * Browser-side route cache in localStorage. Entries carry their own expiry (walking ≤30 days,
 * transit ≤10 minutes, set by CachedRoutingProvider) so the Google caching terms are honoured here too.
 */
export class LocalStorageRouteCacheStore implements RouteCacheStore {
  private data: Persisted = {};
  private loaded = false;

  private load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
      if (raw) this.data = JSON.parse(raw) as Persisted;
    } catch { this.data = {}; }
  }

  private persist() {
    try {
      const now = Date.now();
      const entries = Object.entries(this.data).filter(([, v]) => v.expiresAt > now).sort((a, b) => b[1].expiresAt - a[1].expiresAt).slice(0, MAX_ENTRIES);
      this.data = Object.fromEntries(entries);
      window.localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch { /* quota or private mode: in-memory only */ }
  }

  get(key: string) {
    this.load();
    const e = this.data[key];
    if (!e) return undefined;
    return { route: deserializeRoute(e.route) as RouteOption, expiresAt: e.expiresAt };
  }

  set(key: string, entry: { route: RouteOption | undefined; expiresAt: number }) {
    this.load();
    if (!entry.route) return;
    this.data[key] = { route: serializeRoute(entry.route), expiresAt: entry.expiresAt };
    this.persist();
  }
}
