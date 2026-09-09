# UW GO — Architecture

Deterministic, typed, no LLMs. Business logic lives in `src/domain`, `src/parsers`, `src/rooms`, `src/engine`, `src/routing` and is independent of React. React components render `DayPlan` objects; they never compute recommendations.

```
Quest paste ──▶ questParser ──▶ ParsedSchedule (CourseMeeting[] + warnings)
WLU manual form ─────────────▶ CourseMeeting[]  (university: "WLU")
                                     │
                                     ▼
                      normalizeWeek(meetings, mondayISO)  ──▶ ScheduledClass[] per weekday
                                     │
                                     ▼
                     buildWeekPlan({ meetings, home, mondayISO, config }, provider)
                       ├─ buildTransitions (home→first, class→class, last→home)
                       ├─ RouteMemo → RoutingProvider (walk, + transit when eligible)
                       ├─ chooseRoute + assessFeasibility
                       └─ analyzeHomeReturn for gaps
                                     ▼
                       WeekPlan ──▶ WeekView (timeline + map + Trip Mode)
```

## 1. Domain models (`src/domain/types.ts`)

```ts
type University = "UW" | "WLU";
type DayOfWeek = "M" | "T" | "W" | "Th" | "F" | "S" | "Su";     // Quest/UW-API day codes
type Component = "LEC" | "TUT" | "LAB" | "SEM" | "PRJ" | "PRA" | "DIS" | "TST" | "STU" | "FLD" | "CLN" | "OTHER";
type MinutesOfDay = number;                                     // 0..1439, local wall clock, America/Toronto

interface CourseMeeting {            // one meeting pattern (a Quest section can have several)
  id: string;                        // stable hash of the fields below (domain/ids.ts, djb2/base36)
  university: University;
  courseCode: string;                // "MATH 135"
  courseTitle?: string;
  classNumber?: number;              // Quest class nbr (4–8 digits)
  section?: string;                  // "001"
  component: Component;
  days: DayOfWeek[];
  start: MinutesOfDay; end: MinutesOfDay;
  startDate?: string; endDate?: string;   // ISO yyyy-mm-dd, this meeting row's own range
  location: RawLocation;             // { kind: "ROOM", buildingCode, roomNumber } | { kind: "ONLINE" } | { kind: "TBA" }
  instructors?: string[];
  unscheduled?: boolean;             // Quest showed no day/time (blank or TBA). Never routed.
  source: "QUEST" | "MANUAL";
  includeInPlan: boolean;            // false for TST by default and for anything the user hides
}

interface ParsedSchedule { term?: TermInfo; meetings: CourseMeeting[]; warnings: ParseWarning[];
  dateOrder: "DMY" | "MDY" | "YMD" | "UNKNOWN"; recognised: boolean }

interface CampusBuilding { id; university; code; name; aliases: string[]; latitude?; longitude?;
  coordinatesSource: "UW_ARCGIS" | "OSM" | "UNVERIFIED"; address?; kind: "ACADEMIC" | "RESIDENCE" | "MIXED" | "OTHER";
  parentCode?;                       // parent complex, e.g. SJ1 -> STJ
  floorRule: FloorRule;              // see §4
  residenceLabel? }                  // present => offered as a "where do you live" preset

interface CampusLocation { id; name; university?; latitude; longitude; kind: "BUILDING" | "HOME"; buildingCode? }
interface UserHome { name; latitude; longitude; address?; preset?: { university; buildingCode } }

interface ScheduledClass { id; day; date; start: Date; end: Date; meeting: CourseMeeting; location: CampusLocation; room: ParsedRoom }

interface RouteOption { mode: "WALK" | "TRANSIT"; durationMinutes; distanceMeters?; departureTime?: Date; arrivalTime?: Date;
  steps?: RouteStep[]; polyline?: string; transferCount?; provider: string; computedAt: string; isEstimate: boolean }
interface RouteStep { mode; durationMinutes; distanceMeters?; instruction?; transit?: TransitStepDetails }

interface ClassTransition { id; kind: "HOME_TO_CLASS" | "CLASS_TO_CLASS" | "CLASS_TO_HOME"; from; to;
  departAfter: Date; arriveBy: Date; hasDeadline: boolean; availableMinutes;
  walkingRoute?; transitRoute?; recommendedRoute?; recommendedDeparture?: Date; expectedArrival?: Date;
  feasibility: "COMFORTABLE" | "TIGHT" | "LIKELY_LATE" | "UNKNOWN"; reason?; crossCampus: boolean }

interface HomeReturnAnalysis { possible; recommendation: "WORTH_IT" | "POSSIBLE" | "NOT_RECOMMENDED";
  gapMinutes; travelHomeMinutes; usableHomeMinutes; travelBackMinutes;
  leaveForHomeAt?; arriveHomeAt?; leaveHomeAt?; nextClassStart; routeHome?; routeBack? }

type DayPlanItem =
  | { kind: "LEAVE"; at: Date; from: CampusLocation; transition }
  | { kind: "ARRIVE"; at: Date; to: CampusLocation; transition }
  | { kind: "CLASS"; scheduledClass }
  | { kind: "GAP"; from: Date; to: Date; minutes; homeReturn? }
  | { kind: "NOTE"; text: string };                    // e.g. a leg with no route

interface DayPlan { day; date; classes: ScheduledClass[]; transitions: ClassTransition[]; items: DayPlanItem[]; warnings: string[] }
interface WeekPlan { generatedAt; weekStartDate; days: Partial<Record<DayOfWeek, DayPlan>>;
  skipped: { meeting; reason }[]; usesEstimates: boolean }
```

Times inside `CourseMeeting` are minutes-of-day (no Date, no zone). They become `Date` instants only in `normalizeWeek`, via `TZDate` in `America/Toronto` for a concrete calendar date. This keeps parsing pure and makes DST correctness a single-module concern (`src/time/toronto.ts`).

Because `RouteOption` carries `Date`s, it cannot cross a JSON boundary directly. `src/routing/serialize.ts` (`serializeRoute` / `deserializeRoute`) is the only sanctioned conversion, and both the API handler and the localStorage cache go through it.

## 2. Parser architecture (`src/parsers`)

```ts
interface ScheduleParser { readonly id: "QUEST" | "LORIS"; readonly label: string; parse(text): ParsedSchedule }
```

`questParser` (`quest/QuestParser.ts`) is a **line-oriented island parser** (our own implementation, informed by the survey in DATA_SOURCES.md §2):

1. Normalize: split on `\r?\n`, then collapse every whitespace run inside a line to a single space and trim. Tabs and multi-space column separators therefore stop mattering; blank lines survive as empty strings and act as soft boundaries.
2. Reject wrong pages early with specific messages: Student Center homepage widget (its header row, or two of the surrounding page markers), "You are not registered for classes in this term", Course Selection page. The widget and course-selection checks are suppressed when a real `Class Nbr` table header is present.
3. Term header: `^(Spring|Fall|Winter) (\d{4}) | <level> | <institution>$`, falling back to any `Season YYYY` in the text. `termId` follows Quest's scheme, `(year - 1900) * 10 + {1 Winter, 5 Spring, 9 Fall}`.
4. Course header anchor: `^([A-Z]{2,10})\s+(\d{1,4}[A-Z]{0,2})\s+-\s+(.+)$`. Everything until the next course header is that course's block; inside a block, parsing starts after the `Class Nbr` header row when there is one, which skips the Status/Units/Grading furniture.
5. Then a state machine over the block's lines:
   - `^\(?(\d{4,8})\)?$` starts a new section row → the next two lines are section (`^\d{3}[A-Z]?$`) and component (`^[A-Z]{2,4}$`) when they have that shape. Some pastes put all three on one line ("1234 001 LEC"); that combined form is matched too.
   - A meeting pattern is: a days+time line (`^([A-Za-z]{1,12})\s+<time>\s*-\s*<time>$`, where the day token is expanded by `days.ts`) or `TBA` or a blank line; then a room line; then zero or more instructor lines; then a date range line `^<date> - <date>$`. An unrecognised day token yields a warning and the meeting is kept as `unscheduled` rather than dropped.
   - A meeting pattern that appears without a preceding class-number anchor is a **continuation row** of the current section (verified shape; the bug class other tools have).
6. Date order is inferred per document: try DMY, MDY, YMD; a candidate is accepted only if every date parses and every range is start ≤ end and lies within the term's plausible window (Fall: Aug–Dec, Winter: Jan–Apr, Spring: May–Aug). Ambiguous → `dateOrder: "UNKNOWN"`, dates dropped, warning shown; days/times still usable.
7. Room line → `RawLocation`: `ONLN`/`ONLINE` → ONLINE; `TBA` → TBA; `^([A-Z][A-Z0-9]*)\s+(\d+[A-Z]?)$` → ROOM (whitespace already collapsed, so `MC   4040` → `MC 4040`).
8. Output is fail-soft per course: an unparseable block yields a warning naming the course, never a silently wrong meeting. Duplicate meetings (same course, section, component, days, time, room, dates — i.e. the same stable id) are collapsed with a warning. `recognised` records whether the paste was a Quest List View at all, which is what the UI uses to tell "wrong page" from "no classes".

Quest is a UW system, so every meeting it produces is `university: "UW"`.

Fixtures: 7 real UWFlow pastes (MIT) in `test/fixtures/quest/` plus synthetic cases for edge conditions. Tests cover: normal lecture, LEC+TUT+LAB, multi-day, continuation rows, 5-digit class numbers, TBA room, TBA time, online, blank days line, tabs vs spaces, all three date orders, malformed paste, wrong-page pastes, duplicates, multi-instructor.

`laurierParser` (in `ScheduleParser.ts`) is a stub that returns a `PARSER_NOT_IMPLEMENTED` warning and points to manual entry. `src/parsers/manual.ts` validates the WLU manual form into a `CourseMeeting`, refusing buildings with no coordinates and `end <= start`.

## 3. Building registry (`src/data/buildings`)

`uw-buildings.generated.ts` is produced by `scripts/gen-uw-buildings.mjs` from a committed snapshot of the UW ArcGIS Buildings feature service (`scripts/uw-buildings-arcgis-2026-09-08.geojson`); it is machine-written and must not be hand-edited. `uw.ts` lays the curated overlay on top: residence and college labels, building kinds, aliases and floor rules. `wlu.ts` is hand-curated from Laurier's official pages, with OSM coordinates where noted.

`index.ts` exposes `findBuilding(university, code)` and `findBuildingAnywhere(code, hint)` with alias resolution (`E7`→`PSE` after the 2026 rename, `STP`→`UTD`, `DP`/`DANA PORTER`→`LIB`, plus each building's own aliases such as `BAB`→`BA` and `PETERS`→`P`), `residencePresets(university)` for the home picker, and `buildingLocation(b)`, which returns `undefined` for a building with no coordinates so uncoordinated buildings can still resolve by name without ever being routed. A Quest room code is resolved against the hinted university first; unknown codes stay unresolved and are reported, never guessed.

## 4. Room parser (`src/rooms/roomParser.ts`)

```ts
interface ParsedRoom { raw; buildingCode; buildingName?; roomNumber?; floor: number | "unknown";
  floorConfidence?: "verified" | "likely"; university?; resolved: boolean }
type FloorRule = { kind: "FIRST_DIGIT"; confidence; source }
              | { kind: "DASH_PREFIX"; ... }              // WLU DAWB "2-108"
              | { kind: "LEADING_DIGIT_THEN_WING"; ... }  // WLU Arts "1C16"
              | { kind: "UNKNOWN" }
```

`splitRoomString` handles spaced (`MC 2065`), glued (`BA201`) and WLU wing (`1C16`) forms; `inferFloor` computes the floor **only** from the building's rule, so a building without a verified rule returns `"unknown"` no matter how suggestive the room number looks. Every rule carries a cited `source`. UW `PSE` is `verified` from the E7 floor-plan PDF; UW `MC` is `FIRST_DIGIT/likely` from a single public data point and the UI labels it "unconfirmed".

## 5. Routing provider abstraction (`src/routing`)

```ts
interface RoutingProvider {
  readonly id: string;
  getWalkingRoute(from: LatLng, to: LatLng): Promise<RouteOption | undefined>;
  getTransitRoute(from: LatLng, to: LatLng, opts: { departureTime?: Date; arrivalTime?: Date }): Promise<RouteOption | undefined>;
}
```

- `GoogleRoutingProvider` (server only): REST `computeRoutes` with an explicit `X-Goog-FieldMask`, `travelMode: WALK` / `TRANSIT`, `departureTime` or `arrivalTime` for transit, and `transitPreferences.allowedTravelModes: [BUS, LIGHT_RAIL, RAIL]`. Only the two coordinate numbers are sent — callers pass richer `CampusLocation` objects and the Routes API rejects fields it does not know. Google's response types never leave this file.
- `CachedRoutingProvider` wraps any provider and takes a pluggable `RouteCacheStore`. Walking routes are keyed by rounded origin/destination coordinates (`pairKey`, 5 decimals ≈ 1 m) with a **30-day TTL** (Google Maps Platform Service Specific Terms §19.3); transit routes are keyed by (pair, departure-or-arrival minute) with a 10-minute TTL. It also de-duplicates in-flight requests for the same key, and **never caches a failure** — a route that did not come back is retried next time.
- `EstimateRoutingProvider`: straight-line distance × 1.3 detour factor at 1.35 m/s, minimum one minute. Used **only** when `GOOGLE_MAPS_SERVER_KEY` is absent, always returns `isEstimate: true`, and the plan screen shows a persistent "straight-line estimates" banner whenever `WeekPlan.usesEstimates` is set. Transit is never estimated; it returns `undefined`. This is a labeled fallback, not fake API output.
- `HttpRoutingProvider` (browser): implements the same interface by calling `/api/routes`. The planner in the browser only ever sees `RoutingProvider`.

The two sides compose the same pieces differently:

| Side | Composition | Cache store |
|---|---|---|
| Server (`routing/server.ts`, `server-only`) | `CachedRoutingProvider(GoogleRoutingProvider ?? EstimateRoutingProvider)` | `MemoryRouteCacheStore`, process-wide; on serverless hosts that may be one request |
| Browser (`lib/usePlan.ts`) | `CachedRoutingProvider(HttpRoutingProvider)` | `LocalStorageRouteCacheStore` (`uwgo.routes.v1`, newest 400 entries, expiry per entry) |

Trip Mode is the one deliberate exception. `lib/tripRoute.ts` holds its own uncached `HttpRoutingProvider`, because a trip starting now needs a bus that has not left: a planned transit option is refetched live if it has already departed, was computed more than 3 minutes ago, or leaves more than 45 minutes out, and falls back to the walking route with a visible note if nothing useful comes back.

## 6. Engines (`src/engine`, pure functions)

- `normalize.ts`: `CourseMeeting[]` → per-weekday `ScheduledClass[]` for the week starting at `mondayISO`, respecting each meeting's own date range, sorted by start. Meetings that cannot be placed (excluded, unscheduled, online, TBA, unknown building code, no coordinates, `end <= start`) go to `skipped` with a reason instead of being guessed at. Which week to show is a UI decision, made by `defaultWeekStart` in `lib/usePlan.ts`.
- `transitions.ts`: builds the `ClassTransition` skeleton — home→first class, class→class for every consecutive pair, last class→home. The home leg has `departAfter` at midnight and a real deadline; the trip home has `hasDeadline: false`. Consecutive classes in the same building still produce a transition; the planner short-circuits it.
- `departure.ts`: `recommendedDeparture = arriveBy − ceil(duration) − arrivalBuffer`, plus `clampDeparture` so a plan never tells a student to leave before the previous class ends. Minute-exact integer arithmetic on `TZDate`.
- `feasibility.ts`: `needed = ceil(travel) + arrivalBuffer`. `COMFORTABLE` if `available ≥ needed + comfortMargin`, `TIGHT` if `available ≥ travel`, else `LIKELY_LATE`. Thresholds come from `PlannerConfig`.
- `homeReturn.ts`: for a gap `[prevEnd, nextStart]`, with walking routes both ways, `usable = gap − travelHome − travelBack − arrivalBuffer − buildingExit`. `WORTH_IT` if `usable ≥ minUsefulHomeMinutes`, `POSSIBLE` if `usable ≥ minPossibleHomeMinutes`, else `NOT_RECOMMENDED`; `possible = usable > 0`, and the leave/arrive/leave-again instants are only filled in when it is possible.
- `transitCompare.ts`: eligibility (`shouldConsiderTransit`) = cross-university transition, or walking duration ≥ `transitConsiderWalkMinutes`. `chooseRoute` then prefers whichever option actually arrives on time; when both do, transit must earn the switch on **net** door-to-door time — the travel it saves minus any time it forces the student to set off earlier — by at least 5 minutes. Catching a bus 30 minutes early to save 6 minutes of travel is a loss. Ties go to walking, which has no wait and no bus to miss. If neither arrives on time, the less-late option wins.
- `planner.ts`: the async orchestrator, and the only module that touches a `RoutingProvider`. A per-plan `RouteMemo` fetches each walking pair once for the whole week and traps provider errors; home→class asks transit for an `arrivalTime`, other legs for a `departureTime`. A same-building leg resolves to a zero-minute `SAME_PLACE` route without any call. Any leg that ends up without a route becomes a `NOTE` item plus a warning, never a fabricated duration, and a failed provider call leaves `feasibility: "UNKNOWN"`.

`PlannerConfig` defaults (`src/domain/config.ts`): `arrivalBufferMinutes: 10`, `minUsefulHomeMinutes: 30`, `minPossibleHomeMinutes: 10`, `comfortMarginMinutes: 5`, `transitConsiderWalkMinutes: 18`, `buildingExitMinutes: 0`, `minGapForHomeAnalysisMinutes: 20`. Every number there is a product decision, not a constant of nature.

## 7. Time handling (`src/time/toronto.ts`)

All wall-clock construction goes through `torontoDate(dateISO, minutesOfDay): TZDate`; arithmetic and formatting go through `addMin`, `minutesBetween`, `formatClock`, `formatDuration`, `mondayOfWeek`, `dateForDay`, `weekdayOf`. Formatting uses `date-fns` with `@date-fns/tz` pinned to `America/Toronto`, so neither the developer's nor the user's machine zone is ever consulted. Tests pin the second Sunday in March and the first Sunday in November. No code path uses `new Date(y, m, d, h)`.

## 8. Frontend structure (`src/app`, `src/components`)

- `/` — `Onboarding`: paste box, parse preview with warnings, WLU manual add, home picker, buffer picker, "Build my routes". Redirects to `/plan` once a schedule is stored.
- `/plan` — `WeekView`: week navigation (previous/next/Today), weekday tabs, the next-class card, the day timeline, and one map, with a settings sheet over the top. Redirects back to `/` when there is no schedule.
- `NextClassCard` leads with what matters now — course, room, floor, travel time and the exact minute to leave, counting down live — using `lib/nextClass.ts` (`findNextUp`), which prefers a class in progress, then the next unfinished class in the week, and falls back to a labelled preview when a past or future week is being browsed.
- `DayTimeline` renders `DayPlanItem`s only; it computes nothing. Tapping a class or a leg calls back into `WeekView` to retarget the map.
- **One map instance.** `MapPanel` (`@vis.gl/react-google-maps`, lazily imported, `ssr: false`) takes a `MapSelection` — a `LEG`, a `PLACE`, or the whole `DAY` — and re-frames itself. A second CSS-hidden copy would double Dynamic Maps billing and compute its zoom from a zero-size box, so the map is placed by grid position rather than duplicated. Without a route polyline it draws a dashed geodesic line.
- `TripMode` is a separate fullscreen map for a trip starting now: tilted route-aligned camera, live position, and the freshness logic from `lib/tripRoute.ts`. It needs a real vector Map ID to tilt.
- `lib/mapsLinks.ts` builds keyless Google Maps URLs (`/maps/dir/?api=1`) so every leg is openable in the Google Maps app even with no keys configured; only coordinates go into those URLs.
- State: a React context store (`src/lib/store.tsx`) over a versioned localStorage envelope (`src/lib/storage.ts`, `AppState`, key `uwgo.state.v1`, `migrate()` on read). `loadState` runs after mount only, never during SSR, and every read and write swallows quota/private-mode failures so the app keeps working from memory.
- PWA: `public/manifest.webmanifest` + a minimal service worker that only makes the app installable — it caches no routes, because routing data must stay fresh.

## 9. API boundary (`src/app/api`)

| Route | Method | Input | Output | Notes |
|---|---|---|---|---|
| `/api/routes` | POST | `{ mode: "WALK" \| "TRANSIT", from: LatLng, to: LatLng, departureTime?: ISO, arrivalTime?: ISO }` | `{ route: RouteOptionJSON \| null, error?: string }` | Validates the coordinates are finite and inside the Waterloo Region bounding box; uses the server provider; sets `X-UWGO-Routing: google \| estimate`; never logs bodies. |
| `/api/routes` | GET | — | `{ mode: "google" \| "estimate" }` | Lets the client tell whether real routing is configured. |
| `/api/geocode` | POST | `{ address }` | `{ result?: { latitude, longitude, formattedAddress }, error? }` | Google Geocoding, `region: ca`, bounded to Waterloo Region. 503 when no server key. A vague or partial match outside the region is reported as "not found" rather than "outside the region". Not stored server-side. |

Both handlers run on the `nodejs` runtime. Keys: `GOOGLE_MAPS_SERVER_KEY` (server only; API-restricted to Routes API + Geocoding API), `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` (HTTP-referrer restricted; API-restricted to Maps JavaScript API), optional `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`. `.env.example` explains which prefix means public and which means secret; the README documents the Cloud Console restrictions. A raw browser `fetch` to Routes cannot be referrer-protected, which is why routing goes through the server.

## 10. Privacy and cost rules baked into code

- No analytics, no error telemetry with request bodies.
- The client sends coordinates and times, never course data, to `/api/routes`.
- Walking routes cached per building pair ≤30 days; transit cached ≤10 minutes; failures never cached.
- One map instance on the screen at a time, re-framed rather than re-created, so changing the selection does not bill another map load.
- The planner memoizes walking pairs across the whole week, so a 15-transition week costs at most the number of distinct building pairs.
