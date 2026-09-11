# UW GO

Turn a University of Waterloo (Quest) or Wilfrid Laurier class schedule into a day-by-day movement plan: when to leave, what building and floor the room is in, walk vs. bus/ION, and whether a gap is long enough to go home.

Mobile-first Next.js app. No AI. Students sign in with a Waterloo email, and their parsed schedule and preferences are saved to their account, so a returning student opens straight into their week. The raw Quest paste never leaves the browser, and routing only receives building coordinates and times.

Planning docs: [docs/PRODUCT.md](docs/PRODUCT.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) · [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md)

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill in the keys below (optional for a first look)
npm run dev
```

Open http://localhost:3000 for the landing page and press **Get Started**. Sign in with a @uwaterloo.ca email, then paste a Quest schedule (Quest → Class Schedule → List View → Select All → Copy), choose where you live, and press **Build my routes**.

Routes: `/` landing (signed-in users go straight to `/plan`), `/login` sign-in, `/setup` first-run schedule paste, `/plan` the app.

The plan screen leads with the next class: course, room, floor, how long the trip takes and the exact time to leave, counting down live. Below it is one interactive Google map. Tapping any class or any trip in the timeline retargets the map to that place or that route; "Show whole day" pins every stop of the day including home. Desktop keeps the map beside the timeline; mobile stacks them.

Without Google keys the app still runs in **estimate mode**: walking times are straight-line estimates (clearly labelled), transit is unavailable, the embedded map is hidden, and custom addresses cannot be geocoded. Residence presets and the "Open in Google Maps" links still work.

## Google Maps Platform setup

Create one Google Cloud project with billing enabled and turn on three APIs: **Routes API**, **Geocoding API**, **Maps JavaScript API**. Then create two keys.

| Key | Env var | Application restriction | API restriction | Used for |
|---|---|---|---|---|
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | n/a (public by design; RLS + the Waterloo-only trigger protect data) | Supabase Auth (emailed sign-in code), `user_state` table | Sign-in, and each student's saved schedule and preferences. See docs/SUPABASE_SETUP.md. |
| Server key | `GOOGLE_MAPS_SERVER_KEY` | none (or your server IPs if self-hosting) | Routes API, Geocoding API | `/api/routes` (walking + transit) and `/api/geocode` (custom home address). Never shipped to the browser. |
| Browser key | `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | HTTP referrers: `https://your-domain/*`, `http://localhost:3000/*`, `http://localhost:3010/*` | Maps JavaScript API | Rendering the embedded map. Inlined into the client bundle at build time. With only this key (no server key) the map shows a dashed straight line between buildings instead of a real path. |

Optional: `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` (a Map ID from Map Management) for styled Advanced Markers; without it the demo map id is used.

Why a server proxy for routing: a raw browser `fetch` to the Routes API cannot be protected by HTTP-referrer restrictions (browsers strip the Referer on cross-origin requests), so route calls go through `src/app/api/routes/route.ts` with the server key.

Costs (verified September 2026): Compute Routes Essentials covers both WALK and TRANSIT at $5.00 per 1,000 after 10,000 free requests per month; Dynamic Maps is $7.00 per 1,000 map loads after 10,000 free. Walking routes are cached per building pair for 30 days (the maximum Google's terms allow) and transit itineraries for 10 minutes. The screen holds a single map instance, so changing the selection re-frames that map rather than billing another load. See DATA_SOURCES.md for the cost model.

## What leaves the browser

| Data | Sent? | Where |
|---|---|---|
| Pasted Quest text, instructor names | No | Parsed in the browser; the raw paste and instructor names are never stored or sent |
| Parsed schedule (course codes, titles, sections, days, times, rooms, term) and preferences (home, arrival buffer, gym, route) | Yes, when signed in | Supabase `user_state`, readable and writable only by that student (Row Level Security) |
| Building coordinates + departure/arrival times | Yes | `/api/routes` → Google Routes API |
| Home coordinate | Yes, for legs to/from home | same |
| Custom home address text | Once | `/api/geocode` → Google Geocoding API |
| Map viewport | While the map is on screen | Google Maps JavaScript API |
| Origin + destination coordinates | Only if you tap "Open in Google Maps" | google.com/maps (a plain link, no key) |

The server handlers keep no logs of request bodies. There is no analytics.

## Scripts

```bash
npm run dev          # dev server
npm test             # vitest (parser, engines, routing, registry)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run build        # production build
npm run gen:uw-buildings   # regenerate src/data/buildings/uw-buildings.generated.ts from the ArcGIS snapshot
```

## Project layout

```
src/domain      types + planner config (pure)
src/time        America/Toronto wall-clock helpers (date-fns + @date-fns/tz)
src/parsers     ScheduleParser adapters: quest/ (implemented), LORIS stub, manual entry
src/rooms       room string -> building + floor (only verified floor rules)
src/data        building registry: UW (generated from the campus map service) + WLU (curated)
src/engine      normalize, transitions, departure, feasibility, homeReturn, transitCompare, planner
src/routing     RoutingProvider + Google / Cached / Estimate / Http implementations
src/app         Next.js App Router pages and the two API handlers
src/components  onboarding, plan timeline, map
test/fixtures   real Quest pastes (MIT, from UWFlow) used by the parser tests
```

## Data and licences

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). UW building coordinates come from the University of Waterloo campus map service (used as-is); Laurier coordinates are from OpenStreetMap (ODbL, attribution shown in Settings); Quest fixtures are MIT-licensed from UWFlow.

## Known limits (V1)

- Laurier schedules must be added by hand; LORIS has no paste import yet.
- Floors are shown only where the numbering rule is verified (Laurier buildings, UW PSE). UW MC is shown as "unconfirmed"; other UW buildings say "Floor unknown".
- Three Laurier buildings (Music, 202 Regina, University Place) have no coordinates yet and cannot be routed. The rest of the Waterloo campus is covered.
- Alternating-week labs and satellite campuses (Cambridge, Kitchener, Stratford) are not handled.
