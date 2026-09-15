import { describe, expect, it } from "vitest";
import type { CampusLocation, ClassTransition, RouteOption } from "@/domain/types";
import { choiceShowing, routeChoices, sameWay, transitLabel } from "./routeChoices";

/** September in Waterloo is UTC-4. */
const at = (hhmm: string) => new Date(`2026-09-15T${hhmm}:00-04:00`);
const place = (code: string): CampusLocation => ({ id: code, name: code, latitude: 43.47, longitude: -80.54, kind: "BUILDING", buildingCode: code });
const walk = (minutes: number, over: Partial<RouteOption> = {}): RouteOption => ({ mode: "WALK", durationMinutes: minutes, polyline: `walk-${minutes}`, provider: "google-routes", computedAt: "", isEstimate: false, ...over });
const bus = (lineShort: string, leave: string, arrive: string, minutes: number, vehicle = "Bus"): RouteOption => ({
  mode: "TRANSIT", durationMinutes: minutes, polyline: `bus-${lineShort}`, provider: "google-routes", computedAt: "", isEstimate: false,
  departureTime: at(leave), arrivalTime: at(arrive),
  steps: [
    { mode: "WALK", durationMinutes: 3 },
    { mode: "TRANSIT", durationMinutes: minutes - 5, transit: { line: "University", lineShort, vehicle, departureStop: "UW Station", arrivalStop: "Laurier", departureTime: at(leave), arrivalTime: at(arrive) } },
    { mode: "WALK", durationMinutes: 2 },
  ],
});

/** MC -> DC after a class that ends at 9:50, for a 10:30 class, with a 10 minute buffer. */
function leg(over: Partial<ClassTransition>): ClassTransition {
  return {
    id: "mc->dc", kind: "CLASS_TO_CLASS", from: place("MC"), to: place("DC"),
    departAfter: at("09:50"), arriveBy: at("10:30"), hasDeadline: true, availableMinutes: 40,
    feasibility: "COMFORTABLE", crossCampus: false, ...over,
  };
}

const BUFFER = 10;

describe("the ways offered for one leg", () => {
  it("offers the indoor way beside an outdoor walk, timed the way the planner times it", () => {
    const outdoor = walk(8);
    const indoor = walk(10, { polyline: "tunnel", indoorPath: ["MC", "DC"] });
    const t = leg({ walkingRoute: outdoor, indoorRoute: indoor, recommendedRoute: outdoor, recommendedDeparture: at("10:12"), expectedArrival: at("10:20") });
    const choices = routeChoices(t, BUFFER);
    expect(choices.map((c) => [c.key, c.label, c.route.durationMinutes, c.recommended])).toEqual([["best", "Best", 8, true], ["indoors", "Indoors", 10, false]]);
    // The plan's own numbers for its pick; arrive-by less the walk less the buffer for the other.
    expect(choices[0].leaveAt).toEqual(at("10:12"));
    expect(choices[1].leaveAt?.getTime()).toBe(at("10:10").getTime());
    expect(choices[1].arriveAt?.getTime()).toBe(at("10:20").getTime());
  });

  it("offers the fastest walk outdoors, the campus-aware one when there is one, to a student the plan sent indoors", () => {
    const google = walk(8);
    const shortcut = walk(7, { polyline: "through-mc" });
    const indoor = walk(10, { polyline: "tunnel", indoorPath: ["MC", "DC"] });
    const t = leg({ walkingRoute: google, campusWalk: shortcut, indoorRoute: indoor, recommendedRoute: indoor, recommendedDeparture: at("10:10"), expectedArrival: at("10:20") });
    const choices = routeChoices(t, BUFFER);
    expect(choices.map((c) => [c.key, c.label, c.route])).toEqual([["best", "Best", indoor], ["outdoors", "Outdoors", shortcut]]);
    expect(choices[1].leaveAt?.getTime()).toBe(at("10:13").getTime());
  });

  it("offers walking beside a recommended bus, never setting off before the class ends", () => {
    const ride = bus("12", "10:05", "10:18", 13);
    const far = leg({ to: place("LH"), crossCampus: true, walkingRoute: walk(45), transitRoute: ride, recommendedRoute: ride, recommendedDeparture: at("10:05"), expectedArrival: at("10:18") });
    const choices = routeChoices(far, BUFFER);
    expect(choices.map((c) => [c.key, c.label])).toEqual([["best", "Best"], ["walk", "Walk"]]);
    // 10:30 less 45 less 10 is 9:35, before the class lets out at 9:50: the walk leaves at 9:50 and is honest about landing late.
    expect(choices[1].leaveAt?.getTime()).toBe(at("09:50").getTime());
    expect(choices[1].arriveAt?.getTime()).toBe(at("10:35").getTime());
  });

  it("offers a priced bus beside a walk, on the bus's own timetable", () => {
    const ride = bus("201", "10:08", "10:19", 11);
    const t = leg({ walkingRoute: walk(14), transitRoute: ride, recommendedRoute: walk(14), recommendedDeparture: at("10:06"), expectedArrival: at("10:20") });
    const [, transit] = routeChoices(t, BUFFER);
    expect(transit).toMatchObject({ key: "transit", label: "Bus 201", recommended: false });
    expect(transit.leaveAt).toEqual(at("10:08"));
    expect(transit.arriveAt).toEqual(at("10:19"));
    expect(transitLabel(bus("301", "10:00", "10:10", 10, "Light rail"))).toBe("ION");
  });

  it("offers nothing that is the same way again, and nothing at all for one building", () => {
    const outdoor = walk(8);
    const sameAgain = walk(8);
    expect(sameWay(outdoor, sameAgain)).toBe(true);
    // Same minutes through the tunnel is still a different way to go.
    expect(routeChoices(leg({ walkingRoute: outdoor, indoorRoute: walk(8, { polyline: "tunnel", indoorPath: ["MC", "DC"] }), recommendedRoute: outdoor }), BUFFER).map((c) => c.key)).toEqual(["best", "indoors"]);
    expect(routeChoices(leg({ walkingRoute: outdoor, indoorRoute: sameAgain, recommendedRoute: outdoor }), BUFFER).map((c) => c.key)).toEqual(["best"]);
    const here = walk(0, { polyline: undefined });
    expect(routeChoices(leg({ walkingRoute: here, indoorRoute: walk(2, { indoorPath: ["MC"] }), recommendedRoute: here }), BUFFER).map((c) => c.key)).toEqual(["best"]);
    expect(routeChoices(leg({}), BUFFER)).toEqual([]);
  });

  it("sets off when free on a leg with no class to make", () => {
    const outdoor = walk(8);
    const home = leg({ kind: "CLASS_TO_HOME", hasDeadline: false, arriveBy: at("09:50"), walkingRoute: outdoor, indoorRoute: walk(12, { indoorPath: ["MC", "DC"] }), recommendedRoute: outdoor, recommendedDeparture: at("09:50"), expectedArrival: at("09:58") });
    const [, indoors] = routeChoices(home, BUFFER);
    expect(indoors.leaveAt).toEqual(at("09:50"));
    expect(indoors.arriveAt?.getTime()).toBe(at("10:02").getTime());
  });

  it("names the choice the map is showing, and the plan's pick for anything else", () => {
    const outdoor = walk(8);
    const indoor = walk(10, { indoorPath: ["MC", "DC"] });
    const choices = routeChoices(leg({ walkingRoute: outdoor, indoorRoute: indoor, recommendedRoute: outdoor }), BUFFER);
    expect(choiceShowing(choices, indoor)).toBe("indoors");
    expect(choiceShowing(choices, outdoor)).toBe("best");
    expect(choiceShowing(choices, undefined)).toBe("best");
  });
});
