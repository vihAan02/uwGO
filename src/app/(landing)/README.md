# Landing page

- Repository: UW GO (Next.js App Router).
- Folder: `src/app/(landing)/`, a route group, so the page is served at `/`.
- Built on `feat/landing-page-scaffold`, integrated as the site root on `feat/app-ui-refresh`.
- Run from the repository root: `npm run dev`, then open the server's root URL.
- For Claude: start in this directory, or explicitly read this folder's CLAUDE.md
  and AGENTS.md before working from the repository root.

`page.tsx` is the landing design: header, hero, product panel, three steps, closing CTA,
footer. Get Started links to `/login`. Layout and typography live in `landing.module.css`;
the product panel in `_components/ProductDemo.tsx` + `demo.module.css`; the hero entrance
in `_components/Reveal.tsx`; the shadcn-derived button in `_components/ui/button.tsx` with
`cn` in `_lib/utils.ts`. Sources consulted, decisions, and the type/colour/motion spec are
in `DESIGN.md` here.

Dependencies added for this page only: `animejs`, `class-variance-authority`, `clsx`,
`tailwind-merge`. No shadcn CLI init was run; the button source was copied by hand and
retokened to the app theme, so `globals.css` and the app are unchanged.

Visual verification: no tool named "Poly" exists in this environment. Captures were taken
with the headless `browse` binary from the gstack skill (Playwright Chromium) at desktop,
laptop, tablet, and phone widths; the Claude desktop Browser pane was tried first but does
not paint while hidden. Details and the checks run are in `DESIGN.md`. Screenshots are
session artefacts and are not committed.

## Integration

`/` is public in `src/lib/auth/decide.ts`; every other app path still needs a verified
Waterloo user. A signed-in visitor at `/` is redirected to `/plan`, and a session with a
non-Waterloo email is signed out as before. `/landing`, the old preview path, is a permanent
redirect to `/` in `next.config.ts`.

The page inherits the root layout, global base styles, auth/store providers, account sync,
and service worker. Do not move or change those shared systems for landing design.

The journey: Get Started -> `/login` (a sign-in code sent by email) -> `/plan`, which sends a
student without a schedule to `/setup` to paste it, then back to `/plan`. Login and setup
both replace their history entry on success, so back from the app returns to the landing
page rather than into a form.
