# UW GO — Build plan

Phases are small and each ends with tests passing. Status is updated as work lands.

| # | Phase | Deliverable | Status |
|---|---|---|---|
| 0 | Research + planning docs | `docs/*.md`, findings on UWFlow, Quest format, Google Maps Platform, UW/WLU building data, GRT | Done |
| 1 | Project setup + domain types | Next.js 16 / TS / Tailwind 4 / Vitest; `src/domain/types.ts`, `config.ts`; `.env.example`; README | Done |
| 2 | Building registry | `src/data/buildings/{uw,wlu,index}.ts` from verified sources with aliases, residences, floor rules; tests | Done |
| 3 | Quest parser + fixtures | `src/parsers/quest/*`, 7 real fixtures vendored with attribution, synthetic edge fixtures, tests for every case in ARCHITECTURE §2 | Done |
| 4 | Normalization + timeline engine | `src/time/toronto.ts` (DST tests), `engine/normalize.ts`, `engine/transitions.ts` | Done |
| 5 | Home/location model | `UserHome`, presets from registry, manual WLU class model + validation, localStorage envelope | Done |
| 6 | Routing provider | `RoutingProvider`, `GoogleRoutingProvider` (server), `CachedRoutingProvider`, `EstimateRoutingProvider`, `/api/routes`, `/api/geocode` | Done |
| 7 | Walking route calculations | Planner wiring for walk legs; per-pair memoization; fixture provider for tests | Done |
| 8 | Departure + feasibility engine | `engine/departure.ts`, `engine/feasibility.ts` + tests (10:00 class, 15 min, 10 buffer → 9:35) | Done |
| 9 | "Can I go home?" engine | `engine/homeReturn.ts` + threshold tests (worth it / barely / not enough / back-to-back / exact threshold) | Done |
| 10 | Transit support | Transit in `GoogleRoutingProvider` with `departureTime`, `transitDetails` mapping, short-TTL cache | Done |
| 11 | UW ↔ WLU comparison | `engine/transitCompare.ts`, eligibility rules, tests (UW→WLU, WLU→UW, walking wins, transit wins) | Done |
| 12 | Onboarding UI | Paste box, parse preview + warnings, WLU manual add, home picker, buffer picker | Done |
| 13 | Daily timeline UI | Weekly tabs, day timeline cards, gap/home cards, transit alternative cards | Done |
| 14 | Map | Per-transition Google map with markers + polyline, lazy-loaded | Done (needs a browser key to render) |
| 15 | Mobile polish + persistence | PWA manifest, one-handed layout pass, settings sheet, migrations | Done (manifest, service worker, settings sheet, localStorage envelope) |
| 16 | Test/audit pass | Full test run, lint, type-check, privacy checklist, cost checklist, README setup walkthrough | In progress: 100 unit tests, lint and type-check clean, production build verified; live Google key run still pending |

## Conventions

- Business logic never imports React or Google types. Components import from `src/domain` and `src/engine` only.
- Every engine function is pure and unit-tested; the planner is the only async orchestrator.
- Times: minutes-of-day in models, `TZDate` at the edges. No machine-zone dependence.
- Commits: one logical change each. Nothing is pushed unless the owner asks.
- No fake API output in production code paths. The estimate provider is labeled as such in data and UI.

## Verified in the browser (2026-09-08)

Pasted a Fall 2026 List View schedule (incl. a continuation row and an online row), added a Laurier class by hand, chose UW Place, built the plan. Wednesday timeline: leave UWP 8:08 for MATH 135 at 8:30 (12 min est. walk + 10 min buffer), MC → DC flagged Tight (3 min walk in a 10 min gap), 2 hr 40 min gap flagged Worth going home with leave-home-by 12:41 PM. Monday: UWP → Lazaridis Hall cross-campus leg. Estimate mode banner shown because no Google key was configured.

## Open items carried from research

- Get a Google Cloud project with Routes API, Maps JavaScript API, Geocoding API enabled; create the two restricted keys (README).
- Confirm MC floor rule from a floor plan (needs WatIAM). Until then it is "likely".
- Add coordinates for WLU Peters, Science Building (N), Willison Hall (no OSM match found).
- Decide whether TST (exam) rows should be routable on their date. Default: shown, excluded.
- WLU LORIS paste format: capture a real sample from a Laurier student before building `LaurierParser`.
