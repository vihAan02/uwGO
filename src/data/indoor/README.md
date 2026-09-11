# Campus indoor network

The winter route ("Winter route" next to "Fastest" on every walking leg) is computed over a
graph of Waterloo's tunnels, bridges, hallways, doors, stairs and the short outdoor walkways
between them. This directory holds that graph.

| File | What it is |
|---|---|
| `network.ts` | The shape of the data: nodes are (coordinate, building, floor); edges are typed and carry their geometry and length. |
| `uw-indoor-network.generated.ts` | The data. **Generated, do not edit by hand.** |
| `connections.ts` | Building-to-building links as stated on UW's Campus Accessibility pages. Not used for routing; the audit cross-checks the network against it. |

Regenerate with `node scripts/gen-indoor-network.mjs` (downloads the source at the pinned
commit) and audit with `node scripts/audit-indoor-network.mjs` (writes
`docs/indoor-network-audit.md`).

## Source and attribution

The network is derived from **WATIsGrass** by Ricky Qin and Manasva Katyal,
<https://github.com/rickyqin005/WATIsGrass>, which maps UW's bridges and tunnels as GeoJSON
and computes indoor routes over them. UW Go uses it as follows:

- Only their two GeoJSON files (`web/src/geojson/paths.json`, `buildings.json`) are read, at
  the commit recorded in the generated file. Nothing from their source code is copied; the
  graph builder, the search and the route assembly in `src/engine/indoorGraph.ts` and
  `src/engine/indoorRoute.ts` are UW Go's own.
- The generator keeps the facts (coordinates, what joins what, and how: tunnel, bridge,
  hallway, door, stairs, outdoor walkway) in UW Go's own representation. Building codes
  are mapped to UW's campus-map codes where they differ (DP→LIB, E7→PSE). Their building
  outlines are not used.
- Credit is shown in the app's Settings under "Data".

**Licence.** WATIsGrass is published under the GNU General Public License v3.0. UW Go does
not include or link any of its code. Facts about the campus (where a tunnel runs) are not
themselves copyrightable, but their curated GeoJSON compilation may be, and this generated
file is derived from it. If the authors consider that compilation covered by the GPL, then
`uw-indoor-network.generated.ts` carries GPL-3.0 terms: keep this attribution, keep the
source and commit recorded in the file, and make the file itself available on request.
The safest course is to ask the authors for a data licence (for example CC BY 4.0) and
record it here. Until then, treat that one file as GPL-3.0-derived and do not strip its
header.

## What the network can and cannot say

Every connection comes from the source's survey; nothing is added by hand. Where UW's
accessibility pages state a link the source does not have (the DC–MC and DC–M3 overpasses,
which the source removed in October 2024), the network follows the source and the audit
lists the difference for someone to check on the ground. A pair of buildings the network
does not join gets no winter route, never a straight line.
