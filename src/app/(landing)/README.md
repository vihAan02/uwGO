# Isolated landing-page workspace

- Repository: UW GO (Next.js App Router).
- Initial branch: `feat/landing-page-scaffold`.
- Folder: `src/app/landing/`.
- Preview route: `/landing`.
- Run from the repository root: `npm run dev`, then open the server's `/landing` URL.
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

## Integration boundary

Only the exact `/landing` path is newly public in `src/lib/auth/decide.ts`.
Sibling paths such as `/landing-private` and nested paths remain protected.
Rejected email sessions still follow the existing sign-out policy.
`/`, `/login`, `/plan`, and the authentication callback keep their current behavior.

The preview inherits the existing root layout, global base styles, auth/store providers,
profile sync, and service worker. Isolation is at the source and route level, not a
separate runtime. Do not move or change these shared systems for landing design.

Get Started reuses `/login`; that existing flow authenticates by email and defaults
to `/plan`. The app handles routing users without a schedule into onboarding at `/`.
Verify the complete journey with a test account during integration, without changing
it in the landing-only branch. Login still requires the existing Supabase configuration.

To commit future landing-only work, review the diff and stage explicit files under
this folder. Do not stage shared app changes. Promotion of `/landing` to `/` is a
separate task, with explicit review of auth, onboarding, and layout effects.
