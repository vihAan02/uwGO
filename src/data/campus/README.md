# Campus routing knowledge

What UW Go knows about moving around Waterloo's main campus beyond the shape of its corridors: which
doors may be used which way, which links between buildings still exist, when buildings are open,
what is step-free, how sure we are of each of those, and on whose word. Routing reads it through
`src/engine/indoorGraph.ts` (what a search may use, in which direction, when) and
`src/engine/campusRoute.ts` (which door a walk should use, and whether cutting through a building
is worth it).

| File | What it is |
|---|---|
| `research/uwgo-routing-research-2026-09-14.json` | The research package as delivered, byte for byte. Never edited. |
| `normalize.ts` | Reads the research into UW Go's shapes without adding anything, and reports whatever it cannot map. |
| `types.ts` | The model: evidence, activation, passage per direction, access, availability, and the shapes of the reviewed decisions. |
| `overlay.ts` | UW Go's reviewed decisions: which surveyed segment each research record is about, whether routing may use it, and why. The conflict register and the reviewers' field checks are here too. |
| `field/` | Field verification: observations recorded on the ground and imported as files, kept apart from routing, and the promotions that deliberately turn what they saw into facts. See `field/README.md`. |
| `knowledge.ts` | Indexes research, decisions and promotions for routing, and checks every reference against the surveyed network. |
| `report.ts` | Renders `docs/campus-routing-audit.md`. |

Files here import only types, so the scripts can load them with Node.

## What the research is, and is not

The research lists door *groups* ("Other corner doors, grouped"), links between buildings, route
candidates, rules and their sources. It has no coordinates, no opening hours and no measured times,
and every record has `routing_enabled: false`. None of that is filled in here. A research record
reaches routing only through a decision in `overlay.ts` that attaches it to a segment the WATIsGrass
survey has already drawn.

## Two scales

**Evidence**: how strong the support for a fact is.

| Level | Meaning |
|---|---|
| OFFICIAL | An explicit university statement about this fact. |
| FIELD_VERIFIED | Checked on the ground: a field observation a reviewer promoted (`field/promotions.ts`). Dated, because construction or a new survey can make it stale. |
| CORROBORATED | Two independent sources agree, typically a university page and the survey's geometry pointing at the same door or link. |
| SURVEYED | Drawn by the WATIsGrass survey and nothing more. Real geometry, silent on permission, hours and access. The default for every segment. |
| ANECDOTAL | A student or community report without geometry. |
| INFERRED | A hypothesis, or a match UW Go made that no source states. |
| UNRESOLVED | Sources disagree, or the only statement is undated or disputed. |

SURVEYED is its own level because the survey already runs in production (the winter route). Calling
it anecdotal would switch that off; calling it corroborated would claim more than anyone has said.

**Activation**: whether routing may use a segment at all. ACTIVE (normal routing), EXPERIMENTAL
(only when a caller sets `experimentalCampus`), QUARANTINED (never, until resolved), HISTORICAL
(no longer exists; matched by kind and building pair, so a later survey import cannot bring it back).

How the two combine:

- A **restriction** (may not be entered, needs a key, not step-free) is honoured whatever its
  evidence. It can only remove an option.
- A claim that **widens** what a route may use (a documented step-free elevator, say) needs
  OFFICIAL, FIELD_VERIFIED or CORROBORATED evidence, or ANECDOTAL/INFERRED with `experimentalCampus`.
- UNRESOLVED claims are never used.
- Unknown is never false and never true: an undocumented door is not accessible and not
  inaccessible, it is unknown, and step-free routing treats an unconfirmed change of floor as
  impassable. An elevator the survey records is not assumed step-free either.

## Where a route's evidence comes from

Every campus decision names what activated it (a building's rule, students' closure reports, or the
doors and links of a shortcut) and what each door and link it uses rests on: official research,
community reports, UW Go's review, the WATIsGrass survey, a promoted field observation, or a
combination (`src/engine/campusProvenance.ts`). The route's developer reasoning prints both, and in
development `window.uwgoCampus.legs()` lists them for every planned leg.

## Changing the knowledge

1. Edit `overlay.ts`, never the research JSON. Name each segment by its canonical id, kind and the
   buildings it joins. `campusGraphGeoJSON()` in `src/engine/campusDebug.ts` lists every segment with
   its id and current rules; paste its output into geojson.io to find the one you mean.
2. Write down the basis in plain words, and add or close the matching field check.
3. `npx vitest run src/data/campus src/engine` checks every reference and the routing that depends on it.
4. `node scripts/audit-campus-routing.mjs` regenerates `docs/campus-routing-audit.md`, and
   `npm run campus:field` regenerates the ranked field-verification list.

A new edition of the research goes in `research/` beside the old one. Point `index.ts` at it, then fix
whatever `normalizeResearch(...).issues` reports: a record that gained coordinates or hours is
reported, not silently dropped.

## After someone walks a check

Record it as an observation file, import it, review it and promote only what was observed,
only for the direction and time it was observed (`field/README.md`). A door seen locked inwards at
9 pm is a restriction; a door seen open at noon is not evidence that it is open at 11 pm.
