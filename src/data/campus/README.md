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
| `overlay.ts` | UW Go's reviewed decisions: which surveyed segment each research record is about, whether routing may use it, and why. The conflict register and the field-verification backlog are here too. |
| `knowledge.ts` | Indexes research and decisions for routing, and checks every reference against the surveyed network. |
| `report.ts` | Renders `docs/campus-routing-audit.md`. |

Files here import only types, so `scripts/audit-campus-routing.mjs` can load them with Node.

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
- A claim that **widens** what a route may use (a documented step-free lift, say) needs OFFICIAL or
  CORROBORATED evidence, or ANECDOTAL/INFERRED with `experimentalCampus`.
- UNRESOLVED claims are never used.
- Unknown is never false and never true: an undocumented door is not accessible and not
  inaccessible, it is unknown, and step-free routing treats unknown changes of floor as impassable.

## Changing the knowledge

1. Edit `overlay.ts`, never the research JSON. Name each segment by its canonical id, kind and the
   buildings it joins. `campusGraphGeoJSON()` in `src/engine/campusDebug.ts` lists every segment with
   its id and current rules; paste its output into geojson.io to find the one you mean.
2. Write down the basis in plain words, and add or close the matching field check.
3. `npx vitest run src/data/campus src/engine` checks every reference and the routing that depends on it.
4. `node scripts/audit-campus-routing.mjs` regenerates `docs/campus-routing-audit.md`.

A new edition of the research goes in `research/` beside the old one. Point `index.ts` at it, then fix
whatever `normalizeResearch(...).issues` reports: a record that gained coordinates or hours is
reported, not silently dropped.

## After someone walks a check

Promote only what was observed, only for the direction and time it was observed, and say when in the
basis. A door seen locked inwards at 9 pm is a restriction; a door seen open at noon is not evidence
that it is open at 11 pm.
