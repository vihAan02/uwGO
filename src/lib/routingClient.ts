import { CachedRoutingProvider } from "@/routing/CachedRoutingProvider";
import { HttpRoutingProvider } from "@/routing/HttpRoutingProvider";
import type { RoutingProvider } from "@/routing/RoutingProvider";
import { LocalStorageRouteCacheStore } from "./routeCacheStore";

/**
 * The browser's routing provider: one cache shared by everything in the tab. Building the week
 * plan and rerouting a live trip both come through it, so a walk one has already paid for the
 * other gets for nothing — which matters most for the short walks that join a place to a door
 * of the indoor network, since a reroute asks for those again and again.
 */
let provider: RoutingProvider | undefined;
export function clientRoutingProvider(): RoutingProvider {
  if (!provider) provider = new CachedRoutingProvider(new HttpRoutingProvider(), new LocalStorageRouteCacheStore());
  return provider;
}
