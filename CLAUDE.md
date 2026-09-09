# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev                       # next dev on :3000
npm test                          # vitest run (111 tests, ~1.5s)
npm test -- src/engine/planner.test.ts     # one file
npm test -- -t "COMFORTABLE"      # one test by name
npm run test:watch
npm run typecheck                 # tsc --noEmit
npm run lint                      # eslint (flat config, next core-web-vitals + typescript)
npm run build
npm run gen:uw-buildings          # regenerate src/data/buildings/uw-buildings.generated.ts
```

Vitest runs in the **node** environment and only picks up `src/**/*.test.ts` / `test/**/*.test.ts` — `.tsx` is excluded, so there are no component tests. Logic that needs testing must live outside React. Imports use the `@/*` → `src/*` alias in both tsc and vitest.

## The pipeline

```
Quest paste ─▶ QuestParser ─┐
WLU manual form ────────────┴─▶ CourseMeeting[]  (persisted in localStorage)
                                    │
                normalizeWeek(meetings, mondayISO)   ← resolves building + room + floor,
                                    │                   materializes Dates in America/Toronto
                                    ▼
                     buildWeekPlan(input, RoutingProvider)
                       ├─ buildTransitions   home→first, class→class, last→home (pure)
                       ├─ RouteMemo          one fetch per building pair per plan
                       ├─ chooseRoute        walk vs transit on net door-to-door time (pure)
                       ├─ assessFeasibility  COMFORTABLE / TIGHT / LIKELY_LATE / UNKNOWN (pure)
                       └─ analyzeHomeReturn  is the gap worth going home for (pure)
                                    ▼
                    WeekPlan { days: DayPlan { items: DayPlanItem[] } }
                                    ▼
              WeekView ─▶ DayTimeline / NextClassCard / MapPanel / TripMode
```

`src/engine/planner.ts` is the **only** async orchestrator and the only module that touches a `RoutingProvider`. Everything else in `src/engine` is a pure function with unit tests. Components render `DayPlanItem`s; they never compute a recommendation.

## Layering rules that must not be broken

- **Business logic never imports React or Google types.** `src/domain`, `src/parsers`, `src/rooms`, `src/engine`, `src/routing` (except the Google provider) are framework-free.
- **Google's response shapes stay inside `src/routing/GoogleRoutingProvider.ts`.** The rest of the app sees `RouteOption` only. The Routes API rejects unknown fields, so coordinates are narrowed to `{latitude, longitude}` before being sent — never pass a `CampusLocation` through.
- **All wall-clock work goes through `src/time/toronto.ts`** (`torontoDate`, `addMin`, `minutesBetween`, `formatClock`). Never `new Date(y, m, d, h)`; the machine's zone is never consulted. Models store `MinutesOfDay` (0..1439); `Date`s appear only from `normalizeWeek` onward. DST is pinned by tests in `toronto.test.ts`.
- **`RouteOption` contains `Date`s**, so it cannot be `JSON.stringify`'d directly. Cross a JSON boundary (API response, localStorage) via `serializeRoute` / `deserializeRoute` in `src/routing/serialize.ts`.

## Routing: two caches, one interface

`RoutingProvider` (`getWalkingRoute`, `getTransitRoute`) has four implementations, composed differently per side:

- **Browser** (`src/lib/usePlan.ts`): `CachedRoutingProvider(HttpRoutingProvider, LocalStorageRouteCacheStore)` → `POST /api/routes`.
- **Server** (`src/routing/server.ts`, `server-only`): `CachedRoutingProvider(GoogleRoutingProvider | EstimateRoutingProvider, MemoryRouteCacheStore)`.

TTLs are a licence constraint, not a tuning knob: walking 30 days (Google Maps Platform terms §19.3 caps Routes results at 30 consecutive days), transit 10 minutes because itineraries are time-dependent. `CachedRoutingProvider` also de-dupes in-flight calls and **never caches failures**.

Routing goes through the server because a browser `fetch` to the Routes API cannot be protected by HTTP-referrer restrictions. `/api/routes` and `/api/geocode` validate that both coordinates fall inside `WATERLOO_REGION_BOUNDS`, receive coordinates and times only (never course data), and log nothing.

Without `GOOGLE_MAPS_SERVER_KEY` the app runs in **estimate mode**: `EstimateRoutingProvider` returns straight-line-based walking times with `isEstimate: true`, transit is unavailable, and the UI shows a banner. Keep that labelling intact — fabricated durations presented as real routing are the one thing this codebase is built to avoid.

`src/lib/tripRoute.ts` deliberately **bypasses the cache**: a trip starting now needs a bus that hasn't left, so a planned transit option that is stale, already departed, or more than 45 min out is refetched live and falls back to walking with a note.

## Deliberate refusals to guess

These are load-bearing product decisions, not gaps to fill in:

- `normalizeWeek` drops meetings it cannot place (online, TBA, unknown building code, no coordinates) into `skipped` **with a reason** rather than approximating.
- A routing failure yields `feasibility: "UNKNOWN"` plus a warning, never an invented duration.
- Floors come only from a building's `floorRule` (`src/data/buildings/*`), each with a cited `source` and `verified` / `likely` confidence. UW `MC` is `likely` and the UI says "unconfirmed"; everything else without a rule reads "Floor unknown".
- Quest date order (DMY/MDY/YMD) is inferred per document and validated against the term's plausible window; ambiguous input yields `dateOrder: "UNKNOWN"` and dropped dates, not a coin flip.
- A course block that fails to parse produces a warning naming the course, never a silently wrong meeting.

## Data and state

`src/data/buildings/uw-buildings.generated.ts` is generated from the committed ArcGIS snapshot in `scripts/` — **never hand-edit it**. Curated overlays (residence labels, colleges, aliases like `E7`→`PSE` and `STP`→`UTD`, floor rules) live in `uw.ts`; `wlu.ts` is fully hand-curated with OSM coordinates.

All user state is one versioned localStorage envelope (`AppState`, key `uwgo.state.v1`, `src/lib/storage.ts`) behind a React context store (`src/lib/store.tsx`). `loadState` runs after mount only, never during SSR. Every storage path swallows quota/private-mode errors and keeps working in memory. Bumping the shape means bumping `schemaVersion` and handling it in `migrate`.

## Environment

`GOOGLE_MAPS_SERVER_KEY` (server-only; Routes + Geocoding) and `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` (public by construction; Maps JavaScript API, referrer-restricted), plus optional `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`. Never give a privileged credential a `NEXT_PUBLIC_` prefix. See `.env.example` and the README table for the Cloud Console restrictions.

## Conventions

- Commits: conventional-commit prefixes (`feat(scope):`, `fix(scope):`, `docs:`), one logical change each, subject describing observable behaviour. Nothing is pushed unless the owner asks.
- Tuning numbers belong in `PlannerConfig` (`src/domain/config.ts`), which documents each as a product decision.
- Test doubles follow the `FixtureProvider` pattern in `src/engine/planner.test.ts`: implement `RoutingProvider` with a table of walking minutes keyed by `pairKey`, and assert on formatted clock times.
- Parser tests run against real UWFlow pastes in `test/fixtures/quest/` (MIT, attributed in `THIRD_PARTY_NOTICES.md`). Add a fixture for any new Quest shape rather than a synthetic approximation of one.

## Docs

`docs/ARCHITECTURE.md` is the reference for how the pieces fit together and every file path and identifier in it is current as of the last update — read it before changing anything that crosses module boundaries, and update it in the same commit when you do. `docs/PRODUCT.md` and `docs/DATA_SOURCES.md` explain *why* the design is what it is (product decisions, licensing, cost model). `docs/BUILD_PLAN.md` is a dated build log rather than a description of the present; its older entries describe files that have since been renamed.
