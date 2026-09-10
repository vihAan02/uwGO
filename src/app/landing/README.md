# Isolated landing-page workspace

- Repository: UW GO (Next.js App Router).
- Initial branch: `feat/landing-page-scaffold`.
- Folder: `src/app/landing/`.
- Preview route: `/landing`.
- Run from the repository root: `npm run dev`, then open the server's `/landing` URL.
- For Claude: start in this directory, or explicitly read this folder's CLAUDE.md
  and AGENTS.md before working from the repository root.

`page.tsx` is a deliberately plain placeholder with a Get Started link to `/login`.
`landing.module.css` holds scoped placeholder layout only. No shadcn components or
Anime.js dependency have been installed yet: add only what the actual design uses,
following AGENTS.md. No app redesign or new auth/import flow is included.

Future component source belongs in `_components/ui/`, helpers/animation code in
`_lib/`, and source selections in `DESIGN.md` here. Create these when needed.
Record Poly screenshots/inspection results when its exact tool is identified; visual
verification has not been performed for this scaffold.

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
