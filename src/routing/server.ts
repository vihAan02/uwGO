import "server-only";
import { CachedRoutingProvider, MemoryRouteCacheStore } from "./CachedRoutingProvider";
import { EstimateRoutingProvider } from "./EstimateRoutingProvider";
import { GoogleRoutingProvider } from "./GoogleRoutingProvider";
import type { RoutingProvider } from "./RoutingProvider";

/**
 * Process-wide provider. The in-memory cache only lives as long as the server instance
 * (on serverless hosts that may be one request); it still de-duplicates within a warm instance.
 */
const store = new MemoryRouteCacheStore();
let provider: RoutingProvider | undefined;

export function routingMode(): "google" | "estimate" {
  return process.env.GOOGLE_MAPS_SERVER_KEY ? "google" : "estimate";
}

export function getServerRoutingProvider(): RoutingProvider {
  if (!provider) {
    const key = process.env.GOOGLE_MAPS_SERVER_KEY;
    const inner = key ? new GoogleRoutingProvider(key) : new EstimateRoutingProvider();
    provider = new CachedRoutingProvider(inner, store);
  }
  return provider;
}
