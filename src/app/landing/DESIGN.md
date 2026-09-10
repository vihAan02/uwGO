# UW GO landing: design record

What was consulted, what was taken from it, and the decisions that resulted. Kept next to
the code so the reasoning survives the session that made it.

## Sources consulted

### shadcn/ui (component foundation)

- Button: https://ui.shadcn.com/docs/components/button
  Source copied from the `new-york-v4` registry into `_components/ui/button.tsx`, then
  retokened to the app theme (`bg-brand`, `border-line`, `bg-canvas`, `text-ink`) so the shared
  `globals.css` stays untouched. `asChild`/Slot dropped; links use the documented
  `buttonVariants()` pattern instead, which removes the Radix dependency.
- `cn` helper: https://ui.shadcn.com/docs/installation/manual (`clsx` + `tailwind-merge`) in
  `_lib/utils.ts`.
- Not used: dialog, navigation-menu, card. The page has one action and no navigation, and the
  product panel is bespoke product UI, not a generic card.

### Anime.js v4 (motion)

- React pattern: https://animejs.com/documentation/getting-started/using-with-react
  (`createScope({ root })` in `useEffect`, `scope.revert()` on cleanup).
- Timeline: https://animejs.com/documentation/timeline (absolute positions in ms).
- Media queries on a scope: https://animejs.com/documentation/scope/scope-parameters/media-queries
  (`reduceMotion: "(prefers-reduced-motion: reduce)"`; the scope re-runs if it changes).
- Easing: https://animejs.com/documentation/easings (`out(3)`, `out(4)`, `inOut(2)`; no springs).

### awesome-design-md (design reasoning)

Read from https://github.com/voltagent/awesome-design-md (`design-md/<name>/DESIGN.md`):

| Reference | Principle taken |
|---|---|
| `linear.app` | One chromatic accent, used only on the brand mark, focus ring, and the primary CTA. Product UI framed in panels does the talking; chrome stays minimal. Display type 600 weight with negative tracking scaling from about -3px at 80px to 0 at body. |
| `vercel` | Near-white canvas, ink-black text, hairline dividers, and a four-step surface ladder instead of shadows. Stacked, very subtle shadows (1px/2px at 3-5% black) rather than one heavy drop. Geist for everything narrative, Geist Mono for technical labels. Section rhythm around 96-128px. |
| `apple` | Centered hero: headline, one-line tagline, one small CTA, then the product. Density deliberately low; nothing competes with the product. |
| `stripe` | One filled CTA per band; body text and numerics in tabular figures where times matter. Its gradient mesh was deliberately not taken. |
| `notion` | Centered hero layout and a real product mockup breaking the hero. Its colour spectrum and illustration density were deliberately not taken. |

## Decisions

- **Structure (five blocks):** header, hero, product panel, three steps, closing + footer.
  Nothing else earned a place. The steps stay because they answer "what do I need" (a Quest
  paste and a Waterloo email) in five seconds and set up the Get Started flow.
- **Headline:** "Know where to go. And when to leave." Considered "Your schedule, mapped."
  (elegant but abstract) and "Never wonder when to leave." (the app's own onboarding line,
  but only half the value). The chosen line names both things the product answers and
  breaks cleanly on the period at every width (each sentence is an `inline-block`).
- **Colour:** white canvas, ink `#0f172a`, muted `#64748b`, hairline `#e2e8f0`, the app's
  brand blue `#1d4ed8` on the CTAs only. Inside the dark product card the route uses
  `#60a5fa` (blue on ink, as the app does) and "Leave in 6 min" uses the app's amber
  warning tone for a departure under ten minutes.
- **Surfaces:** the product panel reproduces the app's ladder exactly: canvas `#f4f5f7`
  -> white card -> dark next-class card, with the app's 1rem card radius.
- **Type:** Geist (already loaded by the root layout). Hero `clamp(2.25rem, 1.25rem + 3.6vw, 5rem)`,
  weight 600, line-height 1.04, tracking -0.035em. Lede 17-20px muted. Steps 17px/15px.
  Closing title `clamp(1.75rem, 1.2rem + 2vw, 2.75rem)`. Mono (Geist Mono, tabular) for
  schedule times, step numerals, and route labels.
- **Spacing:** 8px base. Section rhythm `clamp(4rem, 8vw, 7rem)`. Content max 68rem; hero
  copy max 34rem; panel max 52rem. Gutter `clamp(1.25rem, 4vw, 2.5rem)`.
- **CTA:** brand-filled, 0.75rem radius (the app's button radius, not a marketing pill),
  56px tall in the hero, 48px in the closing, 36px outline in the header.
- **Motion:** two pieces only. (1) Hero entrance: title, lede, CTA rise 14px and fade over
  800ms, 90ms stagger, `out(4)`. (2) Product build-up, a single timeline that plays once
  when a quarter of the panel is on screen: panel -> schedule rows (100ms stagger) ->
  connector -> dark card -> walk chip and leave line -> route draws over 1s (`inOut(2)`)
  -> destination dot -> "Leave in 6 min" last. About 2.9s total. Waits 550ms after mount
  if it is already in view so the hero lands first. Hover states are CSS only.
- **Reduced motion / no JS:** `[data-reveal]` is hidden only under
  `prefers-reduced-motion: no-preference`; the scope checks the same query and skips all
  animation; a `<noscript>` override forces everything visible. So the final layout is
  always reachable.
- **Data in the panel:** representative but truthful. Real UW building codes from the
  registry (MC, DC, AL), the app's own formats (`h:mm a`, `9 min`), and the app's rule for
  the leave time (start - walk - 10 min buffer -> 9:41 AM). No floors shown because MC's
  floor rule is only "likely" in the app.

## Visual verification

The instructions asked for "Poly". No tool by that name is installed in this environment
(checked `~/.claude.json`, `settings.json`, plugins, skills, and the desktop config). Two
capable tools exist: the Claude desktop app's built-in Browser pane, and the headless
`browse` binary from the gstack skill (Playwright Chromium). The Browser pane could not
paint while hidden behind the chat, so all captures were taken with the headless binary at
1440x900, 1280x800, 820x1180, 390x844, plus 360x780 overflow checks. Checks run: horizontal
overflow (none), headline line count (2 at every width), every reveal target ends at
opacity 1, route path fully drawn, no console errors from the landing code.
