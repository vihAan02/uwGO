/**
 * Route selection as one problem with two candidate answers. Fixture itineraries here are
 * shaped like the provider's real ones: walk to a stop, ride, walk from a stop, with door
 * times, so the comparison is always door to door.
 */
import { describe, expect, it } from "vitest";
import { resolveBestRoute, type RouteFetcher } from "./bestRoute";
import { chooseRoute } from "./transitCompare";
import { buildWeekPlan } from "./planner";
import { DEFAULT_PLANNER_CONFIG as CFG } from "@/domain/config";
import type { CampusLocation, CourseMeeting, LatLng, RouteOption, UserHome } from "@/domain/types";
import type { RoutingProvider, TransitOptions } from "@/routing/RoutingProvider";
import { CachedRoutingProvider, MemoryRouteCacheStore } from "@/routing/CachedRoutingProvider";
import { pairKey } from "@/routing/RoutingProvider";
import { findBuilding } from "@/data/buildings";
import { addMin, formatClock, minutesBetween, torontoDate } from "@/time/toronto";

const D = "2026-09-14";
const t = (h: number, m = 0) => torontoDate(D, h * 60 + m);

const loc = (u: "UW" | "WLU", code: string, kind: CampusLocation["kind"] = "BUILDING"): CampusLocation => {
  const b = findBuilding(u, code)!;
  return { id: kind === "HOME" ? "home" : `${u}:${code}`, name: b.name, university: u, latitude: b.latitude!, longitude: b.longitude!, kind, buildingCode: code };
};
const UWP = loc("UW", "UWP", "HOME");
const MC = loc("UW", "MC");
const QNC = loc("UW", "QNC");
const home: UserHome = { name: UWP.name, latitude: UWP.latitude, longitude: UWP.longitude, preset: { university: "UW", buildingCode: "UWP" } };

const walk = (min: number): RouteOption => ({ mode: "WALK", durationMinutes: min, distanceMeters: min * 80, provider: "fixture", computedAt: "x", isEstimate: false });

interface BusShape { access: number; ride: number; egress: number; wait?: number; transfers?: number; line?: string }

/** A complete transit itinerary aligned to what was asked: landing at `arrivalTime`, or setting off after `departureTime` plus any wait. */
function bus(opts: TransitOptions, s: BusShape): RouteOption {
  const total = s.access + s.ride + s.egress;
  const departure = opts.arrivalTime ? addMin(opts.arrivalTime, -total) : addMin(opts.departureTime!, s.wait ?? 0);
  const arrival = addMin(departure, total);
  const board = addMin(departure, s.access);
  return {
    mode: "TRANSIT", durationMinutes: total, distanceMeters: total * 200, departureTime: departure, arrivalTime: arrival,
    transferCount: s.transfers ?? 0, provider: "fixture", computedAt: "x", isEstimate: false,
    steps: [
      { mode: "WALK", durationMinutes: s.access },
      { mode: "TRANSIT", durationMinutes: s.ride, transit: { line: s.line ?? "202", vehicle: "Bus", departureStop: "A", arrivalStop: "B", departureTime: board, arrivalTime: addMin(board, s.ride) } },
      { mode: "WALK", durationMinutes: s.egress },
    ],
  };
}

const fetcher = (walkMin: number | undefined, transit?: (o: TransitOptions) => RouteOption | undefined): RouteFetcher & { asked: TransitOptions[] } => {
  const asked: TransitOptions[] = [];
  return {
    asked,
    async walk() { return walkMin === undefined ? undefined : walk(walkMin); },
    async transit(_f, _t, o) { asked.push(o); return transit?.(o); },
  };
};

describe("resolveBestRoute: fastest practical door to door", () => {
  it("TEST A — walking wins: 8 min walk vs 13 min transit", async () => {
    // With the default gate an 8 min walk is not even priced for transit: no bus can beat it by 5.
    const f = fetcher(8, (o) => bus(o, { access: 3, ride: 5, egress: 5 }));
    const r = await resolveBestRoute({ from: MC, to: QNC, departAfter: t(10, 20), arriveBy: t(11) }, f, CFG);
    expect(r.recommended!.mode).toBe("WALK");
    expect(r.consideredModes).toEqual(["WALK"]);
    expect(f.asked).toHaveLength(0);
    // Forced to price it anyway, the comparison still says walk.
    const g = fetcher(8, (o) => bus(o, { access: 3, ride: 5, egress: 5 }));
    const r2 = await resolveBestRoute({ from: MC, to: QNC, departAfter: t(10, 20), arriveBy: t(11) }, g, { ...CFG, transitConsiderWalkMinutes: 0 });
    expect(r2.recommended!.mode).toBe("WALK");
    expect(r2.consideredModes).toEqual(["WALK", "TRANSIT"]);
    expect(r2.reason).toMatch(/faster door to door/);
  });

  it("TEST B — transit wins: 22 min walk vs 12 min door to door, walking legs included", async () => {
    const f = fetcher(22, (o) => bus(o, { access: 3, ride: 7, egress: 2 }));
    const r = await resolveBestRoute({ from: UWP, to: QNC, departAfter: t(0), arriveBy: t(14, 30) }, f, CFG);
    expect(r.recommended!.mode).toBe("TRANSIT");
    expect(r.recommended!.steps!.map((s) => s.mode)).toEqual(["WALK", "TRANSIT", "WALK"]);
    expect(formatClock(r.arrival!)).toBe("2:20 PM"); // lands at the buffer
    expect(formatClock(r.departure!)).toBe("2:08 PM"); // door departure, access walk included
    expect(minutesBetween(r.departure!, r.arrival!)).toBe(12);
    expect(r.reason).toMatch(/saves 10 min/);
  });

  it("TEST C — a 4 min ride is not a 4 min trip: 10 min walk beats 14 min transit", async () => {
    const f = fetcher(10, (o) => bus(o, { access: 5, ride: 4, egress: 5 }));
    const r = await resolveBestRoute({ from: UWP, to: QNC, departAfter: t(13), arriveBy: t(14, 30) }, f, CFG);
    expect(r.consideredModes).toEqual(["WALK", "TRANSIT"]);
    expect(r.transit!.steps!.find((s) => s.mode === "TRANSIT")!.durationMinutes).toBe(4);
    expect(r.recommended!.mode).toBe("WALK");
    expect(r.reason).toMatch(/transit 14 min door to door/);
  });

  it("a transfer costs something: 3 min saved across a transfer is not worth it", async () => {
    const f = fetcher(20, (o) => bus(o, { access: 2, ride: 10, egress: 2, transfers: 1 })); // 14 min, saves 6 raw
    const r = await resolveBestRoute({ from: UWP, to: QNC, departAfter: t(0), arriveBy: t(14, 30) }, f, CFG);
    expect(r.recommended!.mode).toBe("WALK");
    const direct = await resolveBestRoute({ from: UWP, to: QNC, departAfter: t(0), arriveBy: t(14, 30) }, fetcher(20, (o) => bus(o, { access: 2, ride: 10, egress: 2 })), CFG);
    expect(direct.recommended!.mode).toBe("TRANSIT");
  });

  it("TEST F — tight connection: walking gets there before class, so no bus for its own sake", async () => {
    // 10:20 -> 10:30, 9 min walk lands 10:29. A bus landing 10:28 exists. Both are inside the buffer; walk.
    const f = fetcher(9, (o) => (o.departureTime ? bus(o, { access: 1, ride: 5, egress: 1, wait: 1 }) : bus(o, { access: 1, ride: 5, egress: 1 })));
    const r = await resolveBestRoute({ from: MC, to: QNC, departAfter: t(10, 20), arriveBy: t(10, 30) }, f, { ...CFG, transitConsiderWalkMinutes: 0 });
    expect(r.recommended!.mode).toBe("WALK");
    expect(formatClock(r.arrival!)).toBe("10:29 AM");
    expect(r.reason).toMatch(/no bus to miss/);
  });

  it("once class has started, the less late option wins", () => {
    const c = chooseRoute({ departAfter: t(10, 20), arriveBy: t(10, 30), hasDeadline: true, walking: walk(17), transit: bus({ departureTime: t(10, 20) }, { access: 1, ride: 11, egress: 1, wait: 1 }) }, CFG);
    expect(c.recommended!.mode).toBe("TRANSIT"); // 10:34 vs 10:37
  });

  it("with a deadline, transit is asked for by arrival; a bus that would leave before class ends is replaced by the next one", async () => {
    // Asked to land by 10:50, the fixture offers a trip leaving 10:10, before the 10:20 class end.
    const f = fetcher(25, (o) => (o.arrivalTime ? bus(o, { access: 5, ride: 30, egress: 5 }) : bus(o, { access: 5, ride: 6, egress: 5, wait: 3 })));
    const r = await resolveBestRoute({ from: MC, to: QNC, departAfter: t(10, 20), arriveBy: t(11) }, f, CFG);
    expect(f.asked.map((o) => (o.arrivalTime ? "arrive" : "depart"))).toEqual(["arrive", "depart"]);
    expect(formatClock(f.asked[0].arrivalTime!)).toBe("10:50 AM");
    expect(formatClock(f.asked[1].departureTime!)).toBe("10:20 AM");
    expect(r.recommended!.mode).toBe("TRANSIT");
    expect(formatClock(r.departure!)).toBe("10:23 AM");
    expect(formatClock(r.arrival!)).toBe("10:39 AM"); // 16 min door to door vs a 25 min walk leaving 2 min later
  });

  it("without a deadline (going home), the first to get home wins, waiting included", async () => {
    // 12 min walk from 11:20 lands 11:32. A 6 min bus that only leaves 11:35 lands 11:41: walk.
    const late = await resolveBestRoute({ from: MC, to: UWP, departAfter: t(11, 20) }, fetcher(12, (o) => bus(o, { access: 1, ride: 4, egress: 1, wait: 15 })), CFG);
    expect(late.recommended!.mode).toBe("WALK");
    expect(formatClock(late.arrival!)).toBe("11:32 AM");
    // The same bus leaving at 11:21 lands 11:27: transit.
    const soon = await resolveBestRoute({ from: MC, to: UWP, departAfter: t(11, 20) }, fetcher(12, (o) => bus(o, { access: 1, ride: 4, egress: 1, wait: 1 })), CFG);
    expect(soon.recommended!.mode).toBe("TRANSIT");
    expect(formatClock(soon.arrival!)).toBe("11:27 AM");
  });

  it("TEST G — transit unavailable or failing: walking carries on", async () => {
    const none = await resolveBestRoute({ from: UWP, to: QNC, departAfter: t(0), arriveBy: t(14, 30) }, fetcher(22, () => undefined), CFG);
    expect(none.recommended!.mode).toBe("WALK");
    expect(none.consideredModes).toEqual(["WALK", "TRANSIT"]);
    expect(none.reason).toMatch(/no transit itinerary was offered/);
  });

  it("walking unavailable: transit is used when it is valid; nothing is invented when neither is", async () => {
    const onlyBus = await resolveBestRoute({ from: UWP, to: QNC, departAfter: t(0), arriveBy: t(14, 30) }, fetcher(undefined, (o) => bus(o, { access: 3, ride: 7, egress: 2 })), CFG);
    expect(onlyBus.recommended!.mode).toBe("TRANSIT");
    expect(onlyBus.reason).toBe("Transit is the only option.");
    const nothing = await resolveBestRoute({ from: UWP, to: QNC, departAfter: t(0), arriveBy: t(14, 30) }, fetcher(undefined, () => undefined), CFG);
    expect(nothing.recommended).toBeUndefined();
    expect(nothing.departure).toBeUndefined();
  });
});

/** Planner-level: the go-home decision and the itinerary read the same resolutions. */
class ScriptedProvider implements RoutingProvider {
  readonly id = "scripted";
  readonly transitAsked: TransitOptions[] = [];
  constructor(private readonly walks: Record<string, number>, private readonly transit?: (o: TransitOptions, from: LatLng, to: LatLng) => RouteOption | undefined) {}
  async getWalkingRoute(from: LatLng, to: LatLng) {
    const min = this.walks[pairKey(from, to)];
    return min === undefined ? undefined : walk(min);
  }
  async getTransitRoute(from: LatLng, to: LatLng, o: TransitOptions) {
    this.transitAsked.push(o);
    return this.transit?.(o, from, to);
  }
}

let n = 0;
const meeting = (start: number, end: number, building = "MC"): CourseMeeting => ({
  id: `m${++n}`, university: "UW", courseCode: `CS ${100 + n}`, component: "LEC", days: ["M"], start, end,
  location: { kind: "ROOM", buildingCode: building, roomNumber: "1" }, source: "MANUAL", includeInPlan: true,
});
const h = (hh: number, mm = 0) => hh * 60 + mm;

// A 25 min walk each way between UW Place and MC, for the sake of the scenario.
const farWalks = { [pairKey(UWP, MC)]: 25, [pairKey(MC, UWP)]: 25 };

describe("go-home feasibility uses the best route, and the itinerary shows that same route", () => {
  /** `goHome` answers the gap the way a student tapping Rez would; otherwise it is left unanswered. */
  const dayOf = async (provider: RoutingProvider, goHome = false) => {
    const first = meeting(h(10), h(10, 50));
    const second = meeting(h(12, 10), h(13));
    const gapChoices = goHome ? { byDate: {}, byClass: { [`${first.id}:M`]: { kind: "REZ" as const } } } : undefined;
    const plan = await buildWeekPlan({ meetings: [first, second], home, mondayISO: D, config: CFG, days: ["M"], gapChoices }, provider);
    return plan.days.M!;
  };
  const chain = (d: Awaited<ReturnType<typeof dayOf>>) => [...d.transitions.map((x) => x.from.buildingCode), d.transitions[d.transitions.length - 1].to.buildingCode];

  it("control: walking alone leaves too little time at home, so going home is not recommended", async () => {
    const day = await dayOf(new ScriptedProvider(farWalks, () => undefined));
    const gap = day.items.find((i) => i.kind === "GAP");
    expect(gap?.kind === "GAP" && gap.homeReturn?.usableHomeMinutes).toBe(80 - 25 - 25 - 10);
    expect(gap?.kind === "GAP" && gap.homeReturn?.recommendation).toBe("POSSIBLE");
    expect(gap?.kind === "GAP" && gap.recommendation?.recommended).not.toBe("REZ");
    expect(chain(day)).toEqual(["UWP", "MC", "MC", "UWP"]);
  });

  it("a real bus flips the recommendation to going home, without anyone being sent there", async () => {
    const provider = new ScriptedProvider(farWalks, (o) => bus(o, { access: 2, ride: 6, egress: 2, wait: 2, line: "9" }));
    const day = await dayOf(provider);
    const gap = day.items.find((i) => i.kind === "GAP");
    expect(gap?.kind === "GAP" && gap.recommendation?.recommended).toBe("REZ");
    // Recommended, but still not built: the student has not said yes.
    expect(chain(day)).toEqual(["UWP", "MC", "MC", "UWP"]);
  });

  it("TEST D — a real bus makes the gap workable, so the plan goes home on that bus", async () => {
    const provider = new ScriptedProvider(farWalks, (o) => bus(o, { access: 2, ride: 6, egress: 2, wait: 2, line: "9" }));
    const day = await dayOf(provider, true);
    expect(chain(day)).toEqual(["UWP", "MC", "UWP", "MC", "UWP"]);
    const gap = day.items.find((i) => i.kind === "GAP");
    expect(gap?.kind).toBe("GAP");
    if (gap?.kind !== "GAP") return;
    const hr = gap.homeReturn!;
    expect(hr.recommendation).toBe("WORTH_IT");
    expect(hr.routeHome!.mode).toBe("TRANSIT");
    expect(hr.routeBack!.mode).toBe("TRANSIT");
    expect(formatClock(hr.arriveHomeAt!)).toBe("11:02 AM"); // 10:50 + 2 wait + 10
    expect(formatClock(hr.leaveHomeAt!)).toBe("11:50 AM"); // lands 12:00, the buffer before 12:10
    expect(hr.usableHomeMinutes).toBe(48);

    // The legs the timeline shows are, by identity, the routes the decision was made on.
    const [, out, back] = day.transitions;
    expect(out.recommendedRoute).toBe(hr.routeHome);
    expect(back.recommendedRoute).toBe(hr.routeBack);
    expect(back.recommendedDeparture!.getTime()).toBe(hr.leaveHomeAt!.getTime());
    expect(out.recommendedRoute!.steps!.map((s) => s.mode)).toEqual(["WALK", "TRANSIT", "WALK"]);
    expect(back.from.kind).toBe("HOME");
    expect(back.departAfter.getTime()).toBe(out.expectedArrival!.getTime()); // cannot leave home before arriving there
  });

  it("the trip back is asked for by arrival at the buffer, the trip home by departure at the class end", async () => {
    const provider = new ScriptedProvider(farWalks, (o) => bus(o, { access: 2, ride: 6, egress: 2, wait: 2 }));
    await dayOf(provider, true);
    const asked = provider.transitAsked.map((o) => (o.arrivalTime ? `arrive ${formatClock(o.arrivalTime)}` : `depart ${formatClock(o.departureTime!)}`));
    expect(asked).toContain("depart 10:50 AM");
    expect(asked).toContain("arrive 12:00 PM");
    expect(asked).toContain("arrive 9:50 AM"); // home -> first class
  });

  it("TEST G — the transit lookup throwing does not stop the plan; walking carries on and the error is surfaced", async () => {
    const provider: RoutingProvider = {
      id: "broken",
      getWalkingRoute: (f, to) => new ScriptedProvider(farWalks).getWalkingRoute(f, to),
      async getTransitRoute() { throw new Error("transit backend down"); },
    };
    const day = await dayOf(provider);
    expect(day.transitions.every((x) => x.recommendedRoute?.mode === "WALK")).toBe(true);
    expect(day.transitions.filter((x) => x.from.id !== x.to.id).every((x) => x.consideredModes?.includes("TRANSIT"))).toBe(true);
    expect(chain(day)).toEqual(["UWP", "MC", "MC", "UWP"]);
    expect(day.warnings.some((w) => /transit backend down/.test(w))).toBe(true);
  });
});

describe("TEST E — scheduled transit varies by time", () => {
  const byHour = (o: TransitOptions) => {
    const when = o.arrivalTime ?? o.departureTime!;
    const hour = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hour: "numeric", hour12: false }).format(when));
    return bus(o, { access: 2, ride: 6, egress: 2, wait: 2, line: hour < 12 ? "morning 7" : "afternoon 201" });
  };

  it("the planner asks for each leg at its own time and gets that time's itinerary", async () => {
    const provider = new ScriptedProvider(farWalks, byHour);
    const first = meeting(h(9), h(9, 50));
    const second = meeting(h(14), h(14, 50));
    const gapChoices = { byDate: {}, byClass: { [`${first.id}:M`]: { kind: "REZ" as const } } };
    const plan = await buildWeekPlan({ meetings: [first, second], home, mondayISO: D, config: CFG, days: ["M"], gapChoices }, provider);
    const day = plan.days.M!;
    const line = (i: number) => day.transitions[i].recommendedRoute!.steps!.find((s) => s.mode === "TRANSIT")!.transit!.line;
    expect(day.transitions.map((x) => x.recommendedRoute!.mode)).toEqual(["TRANSIT", "TRANSIT", "TRANSIT", "TRANSIT"]);
    expect(line(0)).toBe("morning 7"); // home -> 9:00 class
    expect(line(1)).toBe("morning 7"); // 9:50 -> home
    expect(line(2)).toBe("afternoon 201"); // home -> 14:00 class
    expect(line(3)).toBe("afternoon 201"); // 14:50 -> home
  });

  it("the cache never hands a morning itinerary to an afternoon request", async () => {
    const inner = new ScriptedProvider(farWalks, byHour);
    const cached = new CachedRoutingProvider(inner, new MemoryRouteCacheStore(), () => t(8).getTime());
    const morning = await cached.getTransitRoute(UWP, MC, { arrivalTime: t(8, 50) });
    const afternoon = await cached.getTransitRoute(UWP, MC, { arrivalTime: t(13, 50) });
    const morningAgain = await cached.getTransitRoute(UWP, MC, { arrivalTime: t(8, 50) });
    expect(inner.transitAsked).toHaveLength(2);
    expect(morning!.steps![1].transit!.line).toBe("morning 7");
    expect(afternoon!.steps![1].transit!.line).toBe("afternoon 201");
    expect(morningAgain).toBe(morning);
  });
});
