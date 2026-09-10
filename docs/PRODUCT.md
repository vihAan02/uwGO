# UW GO — Product definition (V1)

Working name: **UW GO**. A mobile-first web app that turns a University of Waterloo (UW) or Wilfrid Laurier University (WLU) student's class schedule into a day-by-day movement plan: when to leave, where the room actually is, walk vs. transit, and what to do with the gaps in between.

This document is the V1 contract. Anything not listed under "In scope" is out of scope until we decide otherwise.

## Who it is for

- UW undergraduates who use Quest and move between UW buildings and a residence or off-campus address.
- UW/WLU double-degree students (BBA/BMath, BBA/BCS) who have classes on both campuses on the same day.
- WLU students, with the caveat below: WLU has no automatic schedule import in V1.

## Core V1 user flow

1. **Paste.** Student opens the app, goes to Quest → Class Schedule → List View → Select All → Copy, and pastes into a large text box. Parsing happens entirely in the browser.
2. **Confirm.** The app shows the parsed classes (course, component, section, days, time, building, room, term) and flags anything it could not parse. Online/asynchronous and TBA rows are shown but marked "no location, skipped for routing". Exam (TST) rows are shown and excluded by default.
3. **Add WLU classes manually (optional).** WLU uses LORIS, not Quest, so V1 has no WLU parser. A small form lets the student add a WLU class (course code, days, start/end, building code, room). These flow through the same models and routing.
4. **Home.** Student picks where they live: a UW residence, a WLU residence, or a custom address (geocoded once, stored locally).
5. **Build my routes.** The app computes, for each weekday, the ordered timeline of legs and classes: leave time, travel mode, arrival, class card with building name and floor when known, gap cards asking what to do after each class, and a walk-vs-transit comparison for cross-campus transitions.
6. **Use it while walking.** Weekly tabs (Mon–Fri), one day at a time, big departure times, map collapsed by default and available per transition.

## What the app answers

| Question | V1 answer |
|---|---|
| When should I leave? | `classStart − travelDuration − arrivalBuffer` (buffer default 10 min, user-selectable 5/10/15). |
| What building is this? | Building registry lookup: code → official name, university, coordinates. |
| What floor is my room on? | Only when the building has a verified numbering rule. Otherwise "floor unknown". Never guessed. |
| How long is the walk? | Google Routes API walking duration between building centroids, cached per building pair. |
| Walk or transit? | For cross-campus (UW↔WLU) and long transitions: departure-time-aware transit itinerary vs. walking, recommendation by expected arrival time. |
| What do I do with this gap? | Stay, go home, the gym, or the nearest library — each priced door to door, one starred, none of them built until the student picks. Choosing the gym asks where they go afterwards. |
| Is this transition feasible? | COMFORTABLE / TIGHT / LIKELY_LATE from available minutes vs. travel + buffer. |


### The gap is a choice, not a verdict

The first version of this decided for the student: if the engine judged a gap worth going home
for, the walk home was already on the timeline. That is the wrong default twice over. It assumes
home is where a free hour goes, when it might be the gym or a library. And it presents a guess as
a plan — the student opens the app and finds a trip they never asked for, with nothing to press.

So the engine now prices every option and recommends one, and builds nothing until asked. The
recommendation ladder — gym then home, gym then a library, gym then class, home, a library, stay
— is ordered for how a day actually goes, and every rung is decided on the minutes usable at the
destination, never on the length of the gap. A ninety-minute gap next to the PAC is not a
ninety-minute gap across campus.

Picking the gym asks one more question, because a workout ends somewhere: home to shower, a
library, or straight to class. Until that is answered nothing is built either, so nobody is
handed a workout they then have to undo.

An option that does not fit is still shown, greyed, with the number that rules it out — "0 min at
home" after an hour's workout is worth seeing. Hiding it would leave the student wondering
whether the app had considered it at all.

## In scope (V1)

- Quest List View paste parser with fixtures and tests (UW).
- Manual WLU class entry (editable), stored with the schedule.
- Building registry seeded with verified UW buildings and residences (official UW map data) and the main WLU academic buildings and residences (names/addresses official; coordinates from OpenStreetMap where no official source exists).
- Room-code translation with per-building floor rules (verified only).
- Home selection: preset residences or custom address with geocoding.
- Weekly plan generation: transitions, walking routes, departure times, feasibility, home-return analysis.
- Transit comparison for cross-campus transitions using Google Routes transit with `departureTime`.
- Daily timeline UI, weekly tabs, per-transition map.
- localStorage persistence (schedule, home, buffer preference) with a versioned envelope. PWA manifest so iOS Safari does not evict local data after 7 days of non-use.
- Documentation of exactly what leaves the browser.

## Out of scope (V1)

- Accounts, sync, sharing, notifications, push.
- Automatic WLU (LORIS) schedule import. LORIS is Ellucian Banner, print-only; its copy format was not verifiable without a Laurier login. Adapter slot exists (`LaurierParser`), implementation deferred.
- Weekly Calendar View paste, Student Center homepage widget paste, Course Selection page paste (detected and rejected with a specific message, not parsed).
- Alternating-week labs. Quest List View text shows no marker for them; each meeting row's own date range is honoured, nothing more.
- Satellite campuses (Cambridge Architecture, Kitchener Pharmacy, Stratford). Their in-schedule room codes were not observed in any real fixture. Unknown codes degrade to "unknown building" and are excluded from routing.
- Indoor routing, entrances, accessibility routing.
- Real-time transit delays (GTFS-RT). Scheduled transit only via Google.
- Fare logic. UW and WLU full-time students hold a GRT U-Pass, so cost is not a factor in the recommendation.
- Weather.
- Any LLM or AI feature. The whole product is deterministic.

## Product decisions locked by research

- **WLU does not use Quest.** WLU support in V1 is manual entry only. This is why the class model carries `university` and why nothing assumes Quest for every class.
- **The ION LRT is not automatically the fast way to Laurier's classrooms.** Laurier–Waterloo Park station is roughly a 10–14 minute walk from Lazaridis Hall / Bricker Academic; routes 202 and 19 stop on University Ave at Laurier's frontage. So the app compares real itineraries by arrival time rather than assuming "train beats walking".
- **Floors are not inferred from the first digit in general.** Verified rules exist for UW's PSE (formerly E7) and for WLU buildings (Laurier states the first numeral is the floor; DAWB uses `floor-room`; Arts wings use `1C16` style). Everything else says "floor unknown" until verified.
- **Building coordinates are centroids.** Walking times are building-door approximations, not room-to-room.
- **Route results are cached at most 30 days** (Google Maps Platform Service Specific Terms §19.3). Building coordinates come from university data, not from Google, so they are cached indefinitely.
- **Parsing is local; routing is not.** The routing proxy sends building coordinates, the home coordinate, and departure times to Google. It never sends course codes, names, or the raw paste. See ARCHITECTURE.md "What leaves the browser".

## Success criteria for V1

- A real Fall 2025/2026 Quest paste from the fixtures parses with zero silent drops, including continuation rows.
- For a schedule with UW classes in MC, DC, E2 and a residence, the Monday timeline shows correct departure times to the minute given the route durations.
- A UW → WLU transition shows both a walking and a transit option with the recommended one chosen by arrival time.
- The gap card matches the engine's unit tests for worth-it / possible / not-enough / back-to-back / exact-threshold cases, and an unanswered gap builds no trip.
- The whole plan renders and is usable on a 375px-wide phone with the map collapsed.
