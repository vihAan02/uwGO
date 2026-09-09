# UW GO — Architecture

Deterministic, typed, no LLMs. Business logic lives in `src/domain`, `src/parsers`, `src/engine`, `src/routing` and is independent of React. React components render `DayPlan` objects; they never compute recommendations.

```
Quest paste ──▶ QuestParser ──▶ ParsedSchedule (CourseMeeting[] + warnings)
WLU manual form ─────────────▶ CourseMeeting[]  (university: "WLU")
                                     │
                                     ▼
                         normalizeWeek(meetings, registry)  ──▶ ScheduledClass[] per weekday
                                     │
                                     ▼
                   buildDayPlan(classes, home, routingProvider, config)
                     ├─ transitions (home→first, class→class, last→home)
                     ├─ routes (walk, + transit when eligible)   ← RoutingProvider
                     ├─ departure + feasibility
                     └─ home-return analysis for gaps
                                     ▼
                                  DayPlan  ──▶ Timeline UI, Map
```

## 1. Domain models (`src/domain/types.ts`)

```ts
type University = "UW" | "WLU";
type DayOfWeek = "M" | "T" | "W" | "Th" | "F" | "S" | "Su";     // Quest/UW-API day codes
type Component = "LEC" | "TUT" | "LAB" | "SEM" | "PRJ" | "PRA" | "DIS" | "TST" | "STU" | "OTHER";
type MinutesOfDay = number;                                     // 0..1439, local wall clock, America/Toronto

interface CourseMeeting {            // one meeting pattern (a Quest section can have several)
  id: string;                        // stable hash of the fields below
  university: University;
  courseCode: string;                // "MATH 135"
  courseTitle?: string;
  classNumber?: number;              // Quest class nbr (4–5 digits)
  section?: string;                  // "001"
  component: Component;
  days: DayOfWeek[];
  start: MinutesOfDay; end: MinutesOfDay;
  startDate?: string; endDate?: string;   // ISO yyyy-mm-dd, this meeting row's own range
  location: RawLocation;             // { kind: "ROOM", buildingCode, roomNumber } | { kind: "ONLINE" } | { kind: "TBA" }
  instructors?: string[];
  source: "QUEST" | "MANUAL";
  includeInPlan: boolean;            // false for TST by default and for anything the user hides
}

interface ParsedSchedule { term?: TermInfo; meetings: CourseMeeting[]; warnings: ParseWarning[]; dateOrder: "DMY" | "MDY" | "YMD" | "UNKNOWN" }

interface CampusBuilding { id; university; code; name; aliases: string[]; latitude?; longitude?;
  coordinatesSource: "UW_ARCGIS" | "OSM" | "UNVERIFIED"; address?; kind: "ACADEMIC" | "RESIDENCE" | "MIXED" | "OTHER";
  floorRule?: FloorRule }           // see §4

interface CampusLocation { id; name; university?: University; latitude; longitude; building?: CampusBuilding; kind: "BUILDING" | "HOME" }
interface UserHome { name; latitude; longitude; address?; preset?: { university; buildingCode } }

interface ScheduledClass { day: DayOfWeek; date: string; start: Date; end: Date; meeting: CourseMeeting; location: CampusLocation; room: ParsedRoom }

interface RouteOption { mode: "WALK" | "TRANSIT"; durationMinutes; distanceMeters?; departureTime?: Date; arrivalTime?: Date;
  steps?: RouteStep[]; polyline?: string; provider: string; computedAt: string; isEstimate: boolean }
interface RouteStep { mode: "WALK" | "TRANSIT"; durationMinutes; distanceMeters?; instruction?; transit?: { line; lineShort?; vehicle; headsign?; departureStop; arrivalStop; departureTime; arrivalTime; stopCount } }

interface ClassTransition { id; from: CampusLocation; to: CampusLocation; departAfter: Date; arriveBy: Date; availableMinutes;
  walkingRoute?; transitRoute?; recommendedRoute?; recommendedDeparture?: Date; feasibility: "COMFORTABLE" | "TIGHT" | "LIKELY_LATE" | "UNKNOWN"; reason?: string }

interface HomeReturnAnalysis { possible; recommendation: "WORTH_IT" | "POSSIBLE" | "NOT_RECOMMENDED"; travelHomeMinutes; usableHomeMinutes; travelBackMinutes;
  leaveForHomeAt?; arriveHomeAt?; leaveHomeAt?; nextClassStart }

type DayPlanItem = { kind: "LEAVE" } | { kind: "ARRIVE" } | { kind: "CLASS" } | { kind: "GAP", homeReturn?: HomeReturnAnalysis } | { kind: "TRANSITION", transition } ...
interface DayPlan { day; date; classes: ScheduledClass[]; transitions: ClassTransition[]; items: DayPlanItem[]; warnings: string[] }
interface WeekPlan { generatedAt; config: PlannerConfig; days: Record<DayOfWeek, DayPlan> }
```

Times inside `CourseMeeting` are minutes-of-day (no Date, no zone). They become `Date` instants only in `normalizeWeek`, via `TZDate` in `America/Toronto` for a concrete calendar date. This keeps parsing pure and makes DST correctness a single-module concern (`src/time/toronto.ts`).

## 2. Parser architecture (`src/parsers`)

```ts
interface ScheduleParser { readonly id: "QUEST" | "LORIS"; detect(text): DetectResult; parse(text): ParsedSchedule }
```

`QuestParser` is a **line-oriented island parser** (our own implementation, informed by the survey in DATA_SOURCES.md §2):

1. Normalize: split on `\r?\n`, trim trailing whitespace, keep blank lines as soft boundaries, collapse runs of tabs/2+ spaces inside header lines.
2. Reject wrong pages early with specific messages: no term header; Student Center widget table (`Class\tDescription\tDays/Times...`); Course Selection page (`My Course Selection`); "You are not registered for classes in this term".
3. Term header: `(Spring|Fall|Winter) (\d{4}) | (Undergraduate|Graduate) | University of Waterloo`.
4. Course header anchor: `^([A-Z]{2,10}) (\d{1,4}[A-Z]{0,2}) - (.+)$`. Everything until the next course header is that course's block.
5. Inside a block: skip the `Status/Units/Grading` block and the `Class Nbr...` header (prefix match, tolerant of separators and header-name variants). Then a state machine over lines:
   - `^\(?(\d{4,8})\)?$` starts a new section row → next non-blank lines are section (`^\d{3}[A-Z]?$`) and component (`^[A-Z]{2,4}$`).
   - A meeting pattern is: days+time line (`^(Su|Sa|Th|M|T|W|F|S|U)+ \d{1,2}:\d{2}(AM|PM)? - \d{1,2}:\d{2}(AM|PM)?$`) or `TBA` or a blank line; then room line; then one or more instructor lines (comma-terminated except last, `Staff`, `To be Announced`); then a date range line `^(\S+) - (\S+)$` with slash dates.
   - A meeting pattern that appears without a preceding class-number anchor is a **continuation row** of the current section (verified shape; the bug class other tools have).
6. Date order is inferred per document: try DMY, MDY, YMD; a candidate is accepted only if every date parses and every range is start ≤ end and lies within the term's plausible window (Fall: Aug–Dec, Winter: Jan–Apr, Spring: May–Aug). Ambiguous → `dateOrder: "UNKNOWN"`, dates dropped, warning shown; days/times still usable.
7. Room line → `RawLocation`: `ONLN - Online` → ONLINE; `TBA` → TBA; `^([A-Z][A-Z0-9]*)\s+(\d+[A-Z]?)$` → ROOM (internal whitespace collapsed, `MC   4040` → `MC 4040`).
8. Output is fail-soft per course: an unparseable block yields a warning naming the course, never a silently wrong meeting. Duplicate meetings (same course, section, component, days, time, room, dates) are collapsed.

Fixtures: 7 real UWFlow pastes (MIT) in `test/fixtures/quest/` plus synthetic cases for edge conditions. Tests cover: normal lecture, LEC+TUT+LAB, multi-day, continuation rows, 5-digit class numbers, TBA room, TBA time, online, blank days line, tabs vs spaces, all three date orders, malformed paste, wrong-page pastes, duplicates, multi-instructor.

`LaurierParser` is a stub that returns "not implemented" and points to manual entry. `src/parsers/manual.ts` validates the WLU manual form into `CourseMeeting`.

## 3. Building registry (`src/data/buildings`)

`uw.ts` is generated from the UW ArcGIS Buildings feature service snapshot (`scripts/import-uw-buildings.ts` → committed TS). `wlu.ts` is hand-curated from Laurier's official pages, with OSM coordinates where noted. `index.ts` exposes `findBuilding(university, code)` with alias resolution (`E7`→`PSE`, `STP`→`UTD`, `DP`→`LIB`, `BAB`→`BA`, `Peters`→`P`), a `residences(university)` list, and `campusOf(code)` heuristics: a Quest room code is resolved against UW first; unknown codes stay unresolved and are reported, never guessed.

## 4. Room parser (`src/rooms/roomParser.ts`)

```ts
interface ParsedRoom { raw; buildingCode; buildingName?; roomNumber?; floor: number | "unknown"; floorConfidence?: "verified" | "likely"; university; building?: CampusBuilding }
type FloorRule = { kind: "FIRST_DIGIT"; confidence: "verified" | "likely"; source: string }
              | { kind: "DASH_PREFIX"; ... }       // WLU DAWB "2-108"
              | { kind: "LEADING_DIGIT_THEN_WING"; ... }  // WLU Arts "1C16"
              | { kind: "UNKNOWN" }
```
Floor is computed only from the building's rule. UW buildings without a verified rule return `"unknown"`. UW `MC` carries `FIRST_DIGIT/likely` and the UI labels it "unconfirmed".

## 5. Routing provider abstraction (`src/routing`)

```ts
interface RoutingProvider {
  id: string;
  getWalkingRoute(from: LatLng, to: LatLng): Promise<RouteOption | undefined>;
  getTransitRoute(from: LatLng, to: LatLng, opts: { departureTime: Date }): Promise<RouteOption | undefined>;
}
```
- `GoogleRoutingProvider` (server only): REST `computeRoutes` with `X-Goog-FieldMask`, `travelMode: WALK` / `TRANSIT`, `departureTime` for transit, `polylineQuality: HIGH_QUALITY`, `transitPreferences.allowedTravelModes: [BUS, LIGHT_RAIL, RAIL]`. Maps Google's response to `RouteOption`; Google types never leave this file.
- `CachedRoutingProvider` wraps any provider. Walking routes are keyed by rounded origin/destination coordinates (5 decimals) with a **30-day TTL** (Google terms). Transit routes are keyed by (pair, departure minute) with a 10-minute TTL. Backing store: in-memory `Map` plus a committed JSON seed (`src/data/route-cache.json`) for well-known building pairs; the seed carries `computedAt` and is ignored past 30 days.
- `EstimateRoutingProvider`: straight-line distance × 1.3 detour factor at 1.35 m/s. Used **only** when `GOOGLE_MAPS_SERVER_KEY` is absent, always returns `isEstimate: true`, and the UI shows a persistent "Estimated, routing API not configured" banner. No transit in this mode. This is a labeled fallback, not fake API output.
- `HttpRoutingProvider` (browser): implements the same interface by calling `/api/routes`. The planner in the browser only ever sees `RoutingProvider`.

## 6. Engines (`src/engine`, pure functions)

- `normalize.ts`: `CourseMeeting[]` → per-weekday `ScheduledClass[]` for a reference week (default: the current week in Toronto, respecting each meeting's date range), sorted by start; online/TBA/excluded meetings dropped with reasons.
- `transitions.ts`: builds `ClassTransition` list: home→first class, class→class for consecutive classes at different locations (same building → zero-length transition), last class→home.
- `departure.ts`: `recommendedDeparture = arriveBy − durationMinutes − arrivalBuffer`. Minute-exact integer arithmetic via `addMinutes` on `TZDate`.
- `feasibility.ts`: `available = arriveBy − departAfter`; `needed = duration + buffer`. `COMFORTABLE` if `available ≥ needed + comfortMargin (5)`, `TIGHT` if `available ≥ duration`, else `LIKELY_LATE`. Thresholds in `PlannerConfig`.
- `homeReturn.ts`: gap `[prevEnd, nextStart]`, home routes both ways: `usable = gap − travelHome − travelBack − arrivalBuffer`. `WORTH_IT` if `usable ≥ minUsefulHomeMinutes (30)`, `POSSIBLE` if `usable ≥ minPossibleHomeMinutes (10)`, else `NOT_RECOMMENDED`; `possible = usable > 0`. Computes leave/arrive/leave-again instants.
- `transitCompare.ts`: eligibility = cross-university transition, or walking duration ≥ `transitConsiderWalkMinutes (18)`. Recommendation = earliest arrival that still meets `arriveBy − buffer`; ties go to walking (no wait risk).
- `planner.ts`: async orchestrator that calls the provider (with per-plan memoization), assembles `DayPlan` items. Any provider failure yields a transition with `feasibility: "UNKNOWN"` and a warning, never a fabricated duration.

`PlannerConfig` defaults: `arrivalBufferMinutes: 10`, `minUsefulHomeMinutes: 30`, `minPossibleHomeMinutes: 10`, `comfortMarginMinutes: 5`, `transitConsiderWalkMinutes: 18`, `buildingExitMinutes: 0`.

## 7. Time handling (`src/time/toronto.ts`)

All wall-clock construction goes through `torontoDate(dateISO, minutesOfDay): TZDate`. Formatting uses `format(date, "h:mm a", { in: tz("America/Toronto") })`. Tests pin the second Sunday in March and first Sunday in November. No code path uses `new Date(y, m, d, h)`.

## 8. Frontend structure (`src/app`, `src/components`)

- `/` — onboarding when no schedule is stored: paste box (clipboard-only textarea), parse preview with warnings, WLU manual add, home picker, buffer picker, "Build my routes".
- `/plan` — weekly tabs (Mon–Fri), daily timeline of cards, per-transition "Show map" toggle, settings sheet (home, buffer, hidden classes, re-paste).
- `components/timeline/*` render `DayPlanItem`s only. `components/map/TransitionMap.tsx` uses `@vis.gl/react-google-maps` with `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`; loaded lazily and only when expanded.
- State: a small store (`src/lib/store.ts`) around a versioned localStorage envelope `{ schemaVersion, schedule, home, config }`; migrations in `src/lib/migrations.ts`.
- PWA: `public/manifest.webmanifest` + minimal service worker (no offline caching of routes).

## 9. API boundary (`src/app/api`)

| Route | Method | Input | Output | Notes |
|---|---|---|---|---|
| `/api/routes` | POST | `{ mode: "WALK" \| "TRANSIT", from: LatLng, to: LatLng, departureTime?: ISO }` | `RouteOption` or `{ error }` | Validates coordinates are within a Waterloo Region bounding box; uses `CachedRoutingProvider(GoogleRoutingProvider)`; falls back to estimates when no key; never logs bodies. |
| `/api/geocode` | POST | `{ address }` | `{ latitude, longitude, formattedAddress }` | Google Geocoding, region `ca`, bounded to Waterloo Region. Not stored server-side. |

Keys: `GOOGLE_MAPS_SERVER_KEY` (server only; API-restricted to Routes API + Geocoding API), `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` (HTTP-referrer restricted; API-restricted to Maps JavaScript API), optional `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`. `.env.example` documents both; README documents the Cloud Console restrictions. A raw browser `fetch` to Routes cannot be referrer-protected, which is why routing goes through the server.

## 10. Privacy and cost rules baked into code

- No analytics, no error telemetry with request bodies.
- The client sends coordinates and times, never course data, to `/api/routes`.
- Walking routes cached per building pair ≤30 days; transit cached ≤10 minutes.
- Map is collapsed by default; one map load per expansion.
- The planner batches unique building pairs per week, so a 15-transition week costs at most the number of distinct pairs.
