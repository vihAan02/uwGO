# Landing-page workspace rules

These rules apply to all work in src/app/(landing). Read README.md here first.

## Scope

- This folder is the one-page landing served at /. Do not redesign the app from here.
- Keep components, shadcn/ui source, animation code, design notes, and CSS in this folder.
  Use private Next folders such as _components/ui and _lib when needed.
- Use CSS Modules or selectors scoped to the landing root. Never edit shared globals,
  root providers/layout, existing app components, auth flows, schedule parsing, or APIs
  as part of landing design work. The page links to /login; any further integration
  is a separate user-authorized task.
- Do not run a root shadcn initializer that rewrites the app theme or shared UI.
  Inspect generated changes and keep component files and theme tokens local.
- Check Git status before work. Stage explicit paths only; do not include unrelated changes.

## Required design resources, not optional inspiration

1. shadcn/ui is the component foundation: https://ui.shadcn.com/docs
   Consult its official components/registry before implementing interactive UI.
   Keep copied source and necessary utilities in _components/ui and _lib here.
   Do not substitute another UI kit or invent equivalent components from scratch.
2. Anime.js is the animation library: https://animejs.com/documentation/
   Use its official React guidance when motion is needed. Keep motion subtle, respect
   reduced motion, and clean up animations. Do not add an alternative animation library.
3. VoltAgent awesome-design-md supplies design logic/reference:
   https://github.com/voltagent/awesome-design-md
   Read a small selection of relevant DESIGN.md references before designing. Record
   exact source links and the principles used in a local DESIGN.md. Favor restraint,
   whitespace, typography, and one clear action; do not copy brands or add sections
   just because a reference contains them.
4. Use the user's Poly/screenshot/browser-checking tool for visual verification.
   Its exact installed tool identifier has NOT been confirmed. Discover that tool
   in the active session or ask the user to identify it before visual verification.
   Do not claim checks were done, install a guessed tool, or silently substitute one.
   Prefer targeted DOM/accessibility inspection and cropped screenshots over repeated
   full-page captures. Check mobile/desktop, focus, overflow, CTA, and reduced motion.

Do not invoke unrelated installed skills, plugins, MCPs, design generators, or review
pipelines. Ordinary file/Git/test tools and official framework documentation are allowed.
Read references on demand rather than loading entire libraries or catalogs into context.
These are session instructions, not a technical sandbox or MCP permission configuration.

## Product direction

Extremely simple, minimal, one-page landing inspired by large modern product websites.
One prominent Get Started CTA. Understated "Built by students, for students" near the
bottom. Intended journey: Get Started -> email/login -> schedule paste/import.
Reuse the existing app journey; do not build a second auth or import system.
The checked-in page is scaffolding only, not the approved visual design.

## Validation

From the repository root: npm run typecheck, npm run lint, npm test.
Run relevant checks before committing. For design work also verify / through
Poly as above and check that /, /login, and /plan retain their existing behavior.
