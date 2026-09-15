# UW GO product design contract

This is the source of truth for how the UW GO app looks, moves and behaves: `/plan`, Trip Mode,
`/courses`, settings, and every state in between. The landing page at `/` keeps its own record in
`src/app/(landing)/DESIGN.md`; the two share tokens, not layouts.

Everything here is a decision, with the reason next to it. When a screen and this document disagree,
fix one of them in the same change.

---

## 1. What UW GO is

UW GO is a campus navigation tool, not a dashboard. The product is one chain:

> where the student is → their schedule → where they go next → the best campus route → the map

Everything else exists to support that chain. The routing engine underneath is sophisticated: campus
shortcuts, entrances, tunnels, closures, winter routes, transit, go-home decisions. The interface is
deliberately not. **More intelligence underneath, less visible complexity above.**

- **Decide, then offer.** UW GO opens with the right answer already chosen: the next class, the best
  route, the minute to leave. A choice appears only when there is a real alternative worth taking.
- **No routing switches.** "Prefer tunnels", "use shortcuts", "entrance mode" are engine concerns and
  never become controls on the planner. A standing need (step-free access, indoors in winter) is a
  profile preference in Settings, not a toggle beside a route.
- **Every element answers "why is this visible now?"** If it cannot, it is removed or disclosed later.
- **Walking use comes first.** The student is often moving, in daylight, with one thumb. Big targets,
  short sentences, one loud number.

## 2. The map and the interface

On a phone the planner is a map with an interface over it, not a page with a map in it.

- **The map is the ground.** One Google map fills the planner, mounted once for the life of the page.
  It never scrolls away, resizes with the sheet, or remounts when the sheet, header, day or selection
  changes. The camera is only moved by route logic (a new selection is framed) or by the student.
- **Everything else is a layer**: a compact header at the top, map controls, and one bottom sheet.
- **What the sheet shows, the map shows.** Picking a leg, a class, a route choice, a day or a quick
  route redraws the map in the same frame. The sheet is never scrolled to reveal the result; the map is
  already visible above it.
- **Framing respects the layers.** A selection is fitted into the part of the map the student can
  see: padding = header height at the top, sheet height at the bottom, 16px sides. When the sheet
  settles at a new detent and the student has not moved the map themselves since the last framing,
  the selection is re-framed into the new visible area. A map the student has panned keeps its zoom
  and is panned by half the change, so what they were looking at stays in the middle. Another way
  between the same places (a route choice) moves the camera only when its line is out of view.
- **The Google logo and attribution stay visible** at the sheet's lowest resting position (Maps
  Platform policy; HIG Maps: 10pt above the lowest resting card). The map layer therefore ends at the
  peek line; the sheet covers it only when the student raises the sheet. Every summary reserves the
  same first block (`PEEK_BLOCK`, 128px), so the peek line, and with it the map's box, does not move
  when the day or the focus changes. In Trip Mode the bottom bar sits at least 36px above the screen's
  bottom edge for the same reason.
- **Overlays on the map are rationed**: locate/recenter, the route, the destination, the student's
  position, and at most one contextual chip. No zoom buttons on phones (pinch exists), no labels
  captioning the map, no floating action buttons.

## 3. Information hierarchy (phone planner)

The sheet answers, in this order, and nothing competes with the first three:

1. **Where am I going next?** Course (or destination), room and building.
2. **When do I leave?** A countdown under an hour ("Leave in 12 min"), a clock time beyond it.
3. **How long will it take?** Minutes and mode ("8 min walk", "11 min indoors", "Bus 201 · 14 min").
4. **What route?** The best way is already on the map. Alternatives only when genuinely different.
5. **Anything unusual?** One line: tight or late, a route adjusted for a closure, a bus that has gone,
   estimated times. Never more than one warning line in the summary; the rest live in the timeline.
6. **Where am I?** The map, with the student's position once they ask for it.

Secondary, in the sheet body: route details, the day's timeline, gap decisions, quick routes from
where the student is, meetings that are not on the map.

## 4. Typography

Geist and Geist Mono, already loaded by the root layout. Weights **400, 500, 600 only** (no 700: it
reads as shouting at phone sizes). Nothing below 12px. Inputs are 16px so iOS Safari does not zoom.

| Role | Size / line | Weight | Notes |
|---|---|---|---|
| Loud number | 28 / 32 | 600 | One per viewport. Tabular figures, -0.02em. The leave countdown on the planner, time left in Trip Mode. |
| Title | 20 / 26 | 600 | The sheet summary's course or destination; screen titles. -0.01em. |
| Row title | 16 / 22 | 600 | Timeline rows, list items. |
| Body | 15 / 22 | 400 | Sentences and secondary lines. |
| Button | 16 / 20 | 600 | Primary and secondary buttons. |
| Label | 14 / 20 | 500 | Chips, segmented controls, links. |
| Meta | 13 / 18 | 400 | `ink-muted`: building names, "arrive 10:20". |
| Time and code | 13 / 18 | 500 | Geist Mono, tabular: the timeline's time rail, room codes where they align. |
| Micro | 12 / 16 | 500 | Badges and the rare caption. Never for anything a student must act on. |

- Hierarchy comes from weight, size and `ink` vs `ink-muted`, never from boxes around values.
- No eyebrow in uppercase tracking inside the app; context labels are sentence case, 13px, muted.
- Numbers that change (countdowns, ETAs) are `tabular-nums` so the line does not jump.
- Prefer wrapping to truncation. Truncate only single-line titles with a known long tail (building
  names), and keep the full text available to screen readers.

## 5. Spacing

4px base. Steps: **4, 8, 12, 16, 20, 24, 32, 48**. Nothing in between.

- Page and sheet side gutter: **16px** on phones, 24px from `sm`.
- Inside one idea (label → value, title → meta): 2–4px.
- Between items of one kind (rows, chips, buttons): 8–12px.
- Between groups (summary → route details → day): 16–24px, marked by a hairline or space, not a card.
- Timeline rows: 12px vertical padding, minimum 48px tall for one line, 56–64px for two.
- Everything fixed to an edge adds the matching `env(safe-area-inset-*)` (§15).

## 6. Surfaces

Fewer containers, better hierarchy. The sheet is already a surface; what is inside it is not a stack
of cards.

| Layer | Token | Use |
|---|---|---|
| Map ground | `map-ground` `#e9ecef` | Behind the map while tiles load and under the sheet's rounded corners. |
| Canvas | `canvas` `#f4f5f7` | Page background on `/courses`, settings and desktop. |
| Surface | `surface` `#ffffff` | The sheet, the header pills, map controls, desktop panels. |
| Fill | `fill` `#eef0f3` | The track of a segmented control, quiet chips, pressed rows. |
| Line | `line` `#e2e8f0` | Hairlines between rows and groups. 1px. |
| Ink surface | `ink` `#0f172a` | Trip Mode's instruction card only. The planner has no dark cards. |

- **A card is an independent object or action.** Inside the sheet: rows with hairlines. A bordered,
  rounded box needs a reason (a modal, the desktop map frame).
- **Opaque over the map.** Text never sits on translucent glass over busy tiles; blur is not used in
  the planner. (NN/g sticky headers; HIG Materials: glass only on controls, never content.)

## 7. Colour roles

The chrome is neutral so that the few coloured things mean something.

- **Brand blue `#1d4ed8`** is spent on four things only: the route on the map, the one primary action
  on screen (Start), the focus ring, and the student's own position. At most one blue-filled element
  per viewport.
- **Selected is ink, not blue.** A selected segment is a white lift on its quiet track, and every
  segment's label stays ink (secondary text on the track is ink at 70%, never `ink-muted`);
  a selected day or quick-route chip is filled ink; a chosen option card is ringed in ink; a selected
  timeline row has a 3px brand rail and a faint brand wash, nothing more.
- **Semantic colours mark state, with words beside them**: `ok` on time, `warn` tight or adjusted,
  `bad` likely late or blocked, `wlu` Laurier. Soft fill + deep text for badges; never a button fill;
  never colour alone.
- On-time needs no colour. Only exceptions are coloured.
- The route line is brand blue whatever the mode; violet stays Laurier's. How the student moves is
  said in words and an icon in the sheet. A leg with no routed line is a dashed straight line.
- Unselected route alternatives on the map are drawn in `ink-muted` at 45% opacity, beneath the
  selected route.

## 8. Elevation

Two shadow tokens, nothing else. Depth inside the sheet comes from surface and hairlines.

| Token | Value | Use |
|---|---|---|
| `shadow-float` | `0 1px 2px rgb(15 23 42 / 0.08), 0 2px 8px rgb(15 23 42 / 0.14)` | Things floating on the map: header pills, map controls. |
| `shadow-sheet` | `0 -1px 0 rgb(15 23 42 / 0.05), 0 -8px 24px -8px rgb(15 23 42 / 0.18)` | The planner sheet's top edge and Trip Mode's bottom bar. |

Modals use the existing sheet/dialog shadow and a 40% ink scrim.

## 9. Shape

One radius grammar. No in-betweens.

| Radius | Where |
|---|---|
| 24px (`rounded-3xl`) | Top corners of the planner sheet and of modal sheets on phones. |
| 16px (`rounded-2xl`) | Cards that remain (desktop map frame, Trip Mode panels, dialogs). |
| 12px (`rounded-xl`) | Rectangular buttons, inputs, segmented control track. |
| 10px (`rounded-[10px]`) | Segments inside a segmented control (track radius minus its 2px inset). |
| Full | Chips, badges, header pills, map controls, avatar, the sheet handle. |

## 10. Icons

- lucide-react, one family, 2px stroke. No emoji anywhere.
- Sizes: 16px inline with text, 20px in controls, 24px only in Trip Mode's instruction.
- An icon beside a word is decoration and is `aria-hidden`. An icon alone is a control and has an
  `aria-label`; icon-only controls are limited to universally understood symbols (close, back,
  locate, recenter, compass).
- Mode icons: `Footprints` walk, `Building2` indoors, `Bus` transit. The same icon means the same
  thing everywhere.

## 11. Touch

- **44×44px minimum hit area for every control.** Primary actions 48px tall. Controls that look smaller
  (a chip, the sheet handle) extend their hit area invisibly to 44px.
- **8px minimum** between adjacent targets.
- **Thumb zone first**: Start, route choices and the sheet itself sit in the bottom half. Header
  actions at the top are for rare navigation, not for trip actions.
- **No destructive or unrelated action beside a trip action.** Deleting data lives in Settings behind a
  confirmation; reporting a closure is disclosed, never a button next to Start.
- Press feedback within 100ms, with no layout shift: buttons, chips, segments and day tabs scale to
  0.97 (under `motion-safe`) and change fill; full-width timeline rows change fill only.
- `touch-action: manipulation` on controls; no hover-only affordances. Under a mouse, anything that
  can be pressed shows the pointer cursor (a base-layer rule in `globals.css`).

## 12. The planner sheet

A standard (non-modal) bottom sheet that is always present on phones and never dismissed. It is a
custom UW GO component (`src/components/plan/PlanSheet.tsx`), not a Drawer or Dialog: it is primary page
content, must not be announced as a dialog, must not portal away from the page, and must keep the same
DOM when the layout becomes the desktop column. shadcn Drawer was evaluated and rejected for this job:
the vaul flavour is unmaintained and its only release ignores `modal={false}`; the Base UI flavour
translates a fixed-height popup, only swipes from non-scrolling regions and renders in a portal.

### Detents

Heights are measured from the planner element (not `window.innerHeight`), so Safari's toolbar and the
keyboard do not make the sheet jump. The rules live in `src/lib/sheetDetents.ts`.

| Detent | Visible height | What it answers |
|---|---|---|
| **Peek** | The summary's first block (128px for every summary) + handle + bottom safe area. Never cut short of that content; at most 60% of the screen | Next class, when to leave, how long, Start. |
| **Mid** | 50% of the screen | Plus route choices, route details and the start of the day. The default. |
| **Expanded** | 76% of the screen, but always leaving at least 176px of map | The whole day, quick routes, skipped meetings. |

- A detent too close to its neighbours (< 96px) is dropped: a landscape phone gets peek and expanded.
- Content keeps the same order at every detent; a taller detent only reveals more of it.
- Resting at peek, the summary's content under its first block fades out, so no line is cut in half by
  the bottom of the screen or sits under the home indicator. It fades back as soon as the sheet is
  dragged or settles higher.

### Gestures and scroll ownership

| Touch starts on | Sheet at peek or mid | Sheet at expanded |
|---|---|---|
| Handle or summary | Drags the sheet | Drags the sheet |
| Body content | Drags the sheet (the body does not scroll) | Scrolls the body; a downward drag with the body at its top drags the sheet |
| The map | Pans the map | Pans the map |

- Ownership is decided on the first 6px of movement and kept for the whole gesture: vertical intent
  goes to the sheet or the list, horizontal intent is left to the browser.
- While dragging, the sheet follows the finger 1:1. Past either end it moves at 35% of the finger.
- On release, the velocity decides: a flick (≥ 0.45px/ms) moves one detent in its direction from where
  the finger let go, never skipping a detent; a slow release settles on the detent nearest where the
  sheet was heading.
- Only one vertical scroller is ever active: the sheet body at expanded. The page itself never scrolls
  on the planner (no rubber-banding behind the map, no pull-to-refresh).
- A mouse or pen drags from the handle and summary. Once pressed it is followed on the document, so a
  release anywhere ends the drag. A wheel or trackpad scroll over the sheet below expanded raises it to
  expanded, and from there scrolls the day.
- The click that ends a mouse drag is swallowed, so it does not press what the drag started on. A
  finger drag makes no click, so nothing waits to swallow one and the next tap always lands.

### Keyboard and assistive technology

- The handle is a real `button` labelled with the current state ("Trip panel, half open") with
  `aria-expanded`; Enter/Space cycles peek → mid → expanded → peek, Arrow Up/Down step one detent,
  Home goes to peek and End to expanded.
- Focus never lands on something hidden: moving into the summary under its first block at peek raises
  the sheet to mid, and moving into the day below the fold raises it to expanded. The map controls
  riding on the sheet's edge are `visibility: hidden` at expanded, so they leave the tab order too.
- The sheet is a `region` labelled "Trip planner"; its summary is the first thing read.

## 13. Header and navigation

- **Phones have no bottom navigation bar.** The app has two places (Plan, Courses) and a profile; a
  permanent bar would cost ~56px + safe area of map and fight the sheet for the bottom edge.
- **Planner header (phones):** floating over the map, safe-area aware: the wordmark on the left, and on
  the right a `Courses` pill (icon + label) and the profile button (settings). Opaque white pills,
  `shadow-float`, 44px tall.
- **Auto-hide.** The header gets out of the way once the student is reading the day:
  - at peek and mid it stays: the student is looking at the map and may want to go somewhere else;
  - at expanded it hides after a deliberate scroll down through the day (≥ 32px of travel in one
    direction, once past the first 24px of the list);
  - it returns after a deliberate scroll up (≥ 24px), near the top of the list, when the sheet leaves
    expanded, when focus enters it, and whenever Trip Mode ends;
  - it is frozen while the sheet is dragged or settling, and hiding it never changes the sheet's detents
    or the map's framing, so the two can never set each other off;
  - it never stops half-hidden and never hides while it holds focus. Away, its controls stay in the
    tab order (moved off screen, never `visibility: hidden`), which is how focus can bring it back;
  - the rules are pure and tested in `src/lib/headerScroll.ts`.
- **Secondary pages** (`/courses`) are normal scrolling pages: a compact sticky header with Back to
  Plan and the page title, hiding on scroll down and returning on scroll up or near the top.
- **Settings** is a modal sheet (bottom on phones, right side on wider screens). Back closes it, the
  way Back ends a trip: it holds a history entry while open (`src/lib/useBackCloses.ts`).
- **Desktop (`lg`+):** the wordmark, Plan/Courses tabs and settings sit in a static header; nothing
  auto-hides.

## 14. Motion

Motion explains a change of state; it is never decoration. Transform and opacity only. The map camera
and the route line are Google Maps' job, not Anime.js's.

| Token | Duration | Easing | Use |
|---|---|---|---|
| press | 100ms | `ease-out` | Button and row press scale. |
| quick | 150ms | `cubic-bezier(0.2, 0, 0, 1)` | Segment selection, cross-fades, number swaps. |
| base | 220ms | enter `cubic-bezier(0.05, 0.7, 0.1, 1)`, exit 180ms `cubic-bezier(0.3, 0, 0.8, 0.15)` | Header in/out, map controls, summary content change. |
| settle | 180–300ms, by distance | Anime.js `out(3)`, from wherever the sheet was let go | Sheet snapping to a detent. |

- **Exits are faster than entrances** (about 80% of the enter duration).
- **Interruptible.** A touch during a sheet or header animation takes over from wherever it is.
- **Never block input**: navigation and selection happen immediately; animation catches up.
- **Nothing loops** except a spinner for a request that is genuinely in flight.
- **Where Anime.js is used**, and why (§20 lists files): the sheet's settle (interruptible from
  wherever it is, which a CSS transition cannot do cleanly), the summary's content swap when the focus changes, the
  route-choice confirmation, the planner route line fading in, Trip Mode's panel phase changes, and a
  row that a rebuilt plan adds to the day fading in. CSS transitions handle presses, the header, the
  summary's lower part at peek, and hover. An entrance gives back its inline transform when it ends.
- Entrance staggers inside the app: at most 30ms per item, 300ms total; the landing page's 800ms
  entrances never carry into the app.

### Reduced motion

`prefers-reduced-motion: reduce` gets the same states without the travel: detents change instantly,
the header appears and disappears with a 100ms opacity fade, content swaps without movement, the route
line appears at full opacity. Direct manipulation still follows the finger; it is the student's own
motion.

## 15. Safe areas and viewports

- `viewport-fit=cover` is set in the root layout. Every fixed element pads by the matching
  `env(safe-area-inset-*)`: the header by top, the sheet's last content and Trip Mode's bottom bar by
  bottom, horizontal insets in landscape.
- Heights use the planner element's measured size or `dvh`, never `100vh`.
- Controls never sit under the home indicator: the sheet's peek includes the bottom inset; Start is
  above it.
- The planner locks document scrolling while it is mounted on a phone (`overscroll-behavior: none` on
  the root) so iOS does not bounce the map and Android does not pull-to-refresh.

## 16. Breakpoints

| Width | Layout |
|---|---|
| < 640px (phones, 320–430) | Full-bleed map, floating header, full-width sheet. |
| 640–1023px (large phones in landscape, tablet portrait) | Same map-first layout. The sheet's surface spans the width and its content is a centred column at most 640px wide, so the map ends on one clean peek line with its logo and terms above it. A landscape phone has no room for mid, so its sheet rests at peek or expanded. |
| ≥ 1024px (`lg`, desktop) | Static header; two columns: the sheet's content as the left column, the map sticky on the right in a 16px-radius frame. No drag, no detents. |

The same component tree renders every layout, switched with CSS. Crossing a breakpoint never remounts
the map or the timeline. Test widths: 320, 360, 375, 390, 430, tablet portrait (768×1024), desktop
(1280, 1440).

## 17. Loading, empty and error states

- **Keep what works on screen.** A refreshing plan keeps the previous plan, map and selection visible;
  only the parts being recomputed dim slightly (`opacity 0.6`) with no spinner overlay.
- **Skeletons only where nothing has existed yet**: the summary and first timeline rows on first load,
  the map ground colour before tiles arrive. Skeletons do not pulse under reduced motion.
- **Local spinners** for requests the student started (a quick route), inside the control that started
  it.
- **Empty states say what is true and what to do**: "No classes on Thursday" with the next day that has
  one; "Nothing left this week" with Next week.
- **Errors are contextual and recoverable**: "Couldn't refresh this route" + Retry beside the thing that
  failed. Never a code, never a full-page error when some of the plan still works. Location denied: say
  the route is the planned one and keep going.

## 18. Accessibility

- Semantic controls: `button` for actions, `a` for navigation, Radix Tabs for days, Toggle Group for
  route choices (a pressed choice cannot be un-pressed into "no route").
- Visible focus: a solid 2px `brand` ring on every focusable element, offset 2px on buttons and pills
  and inset on rows. It stays above 3:1 against white and canvas; a translucent ring does not.
- Focus follows the screen: Trip Mode focuses its heading when it opens and gives focus back to Start
  when it ends; the gap picker moves focus to its choices on open and back to Choose on Done.
- Text contrast ≥ 4.5:1. `ink-muted` (#5b6b80) is 5.4:1 on white and 5.0:1 on canvas; do not go
  lighter, and do not put it on the `fill` or `line` greys. Icons that carry meaning ≥ 3:1.
- State is never colour alone: "Tight", "Likely late", "Reported closed" are words.
- Live regions are polite and sparse: the countdown is not announced every minute; a route change and
  Trip Mode's remaining time are.
- Tap targets per §11. Motion per §14. Text scales to 200% without clipping: rows wrap, never clip.

## 19. Do and don't

| Do | Don't |
|---|---|
| Put the next class, leave time and Start in the sheet's peek. | Put a dark card inside the sheet inside the page. |
| Show "Best · 8 min / Indoors · 10 min" when both are real. | Show "Prefer tunnels", "Winter mode" or "Use shortcuts" switches. |
| Redraw the map the instant a choice is tapped. | Scroll the student back up to see what changed. |
| One hairline between rows. | A border, a radius and a shadow on every row. |
| Brand blue on Start, the route and the focus ring. | Blue chips, blue icons, blue headings. |
| "Couldn't refresh this route · Retry" beside the route. | A red banner at the top that clears the plan. |
| Let the header leave while reading the day. | A header that flickers on 2px of scroll. |
| 44px hit areas, 16px gutters, 12px row padding. | 32px buttons, 10px captions, text flush to the edge. |
| Animate transform/opacity for ≤ 300ms, interruptible. | Animate height, top, or the map camera with JS. |
| A floating Courses pill in the header. | A two-item bottom bar under a bottom sheet. |

## 20. Implementation map

| Concern | Where |
|---|---|
| Tokens (colours, shadows, easing, z-index) | `src/app/globals.css` |
| Motion constants and reduced-motion helper | `src/lib/motion.ts`, `src/lib/useMediaQuery.ts` |
| Detent math and release rules | `src/lib/sheetDetents.ts` (tested) |
| Header hysteresis | `src/lib/headerScroll.ts` (tested) |
| Route choices for a leg | `src/lib/routeChoices.ts` (tested) |
| What the planner is focused on | `src/lib/planFocus.ts` (tested) |
| The day the planner opens on | `src/lib/openingDay.ts` (tested) |
| Touch ownership, release velocity, the click guard | `src/lib/sheetGesture.ts` (tested) |
| Framing, and the camera's answer to a settled sheet | `src/lib/mapFraming.ts` (tested) |
| Back closes a layer | `src/lib/useBackCloses.ts` |
| Planner composition | `src/components/plan/WeekView.tsx` |
| Sheet, summary, header | `src/components/plan/PlanSheet.tsx`, `TripSummary.tsx`, `PlanHeader.tsx` |
| Map layer and framing | `src/components/map/MapPanel.tsx` |
| Trip Mode | `src/components/map/TripMode.tsx` |

z-index scale: map 0 · map controls 10 · planner sheet 20 · header 30 · Trip Mode 40 · modal overlays
50 · alerts 60. Alerts are portalled to the body: inside the phone planner's fixed shell they would
stack under a modal.

## 21. Where this came from

Resources consulted for this contract (September 2026), and what each one decided:

- **UI/UX Pro Max** (installed skill): priority order (accessibility, touch, performance first); 44px
  targets and 8px spacing; 150–300ms motion with exits faster than entrances; transform/opacity only;
  no nested scroll regions; `dvh` over `100vh`; derived boolean media queries instead of window width;
  skeletons for >300ms loads; errors with a recovery path. Its generated style (a landing-page pattern,
  Lora/Raleway, "exaggerated minimalism") was rejected as wrong for a navigation tool.
- **shadcn/ui** (https://ui.shadcn.com/docs/components): Button, Tabs, Toggle Group, Sheet,
  AlertDialog, Popover, Skeleton are used as accessible primitives, retokened to this document. Drawer
  (https://ui.shadcn.com/docs/components/base/drawer, https://ui.shadcn.com/docs/components/radix/drawer)
  was evaluated for the planner sheet and rejected (§12). Scroll Area was rejected for the sheet body:
  native scrolling is simpler and nested scroll detection gains nothing.
- **Anime.js** (https://animejs.com/documentation/): used through `animate`, `createScope` with a
  reduced-motion media query, and spring easing, following its React guidance.
- **awesome-design-md** (https://github.com/VoltAgent/awesome-design-md), principles, not looks:
  - Uber: the task card (where → when → one action) as the peek; floating white controls with a small
    shadow; one filled primary per viewport.
  - Airbnb: a bottom bar that summarises the current choice with one action; one loud number; status in
    ink; hairline rows instead of cards; one shadow tier.
  - Apple (apple.com): the interface recedes; a strict radius grammar; 44px circular controls; press
    scale.
  - Linear: selected is a surface lift, not a colour; the accent is rationed; mono for codes and times.
  - Vercel: the Geist scale and 400/500/600 weights; stacked low-opacity shadows.
  - Spotify: a live surface that stays at every size (the peek; Trip Mode's bar); active by weight.
  - Wise and Revolut: brand colour never means "ok"; one accent element per viewport.
  - Tesla: one message and at most two actions in a driving-style mode (Trip Mode); one timing.
  - The library has no Google Maps, Apple Maps or Waze entries; those came from outside it.
- **Outside the library:** Apple HIG Sheets, Maps, Motion, Accessibility, Tab bars
  (https://developer.apple.com/design/human-interface-guidelines/): non-modal detented sheets, a
  grabber that cycles detents with VoiceOver, logo above the lowest resting card, cancelable motion.
  Material bottom sheets, top app bar and motion
  (https://github.com/material-components/material-components-android/tree/master/docs): standard
  sheets have no scrim; half-expanded 0.5; hide-on-scroll with snap; emphasized easing. Google Maps'
  2025 sheet redesign (https://9to5google.com/2025/03/07/google-maps-iphone-sheet-redesign/): sheets
  over a persistent map, controls moved to the bottom for reach. NN/g on bottom sheets and sticky
  headers (https://www.nngroup.com/articles/bottom-sheet/, https://www.nngroup.com/articles/sticky-headers/):
  no stacked sheets, opaque partially persistent headers. Google Maps Platform policies
  (https://developers.google.com/maps/documentation/javascript/policies): never obscure the logo.
