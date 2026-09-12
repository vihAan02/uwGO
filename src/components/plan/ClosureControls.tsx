"use client";
import { useState } from "react";
import { Check, Construction } from "lucide-react";
import type { RouteOption } from "@/domain/types";
import { UW_INDOOR_NETWORK as NET } from "@/data/indoor/uw-indoor-network.generated";
import { edgeById, edgeLabel, labelForEdgeId } from "@/data/indoor/edgeId";
import { useClosures } from "@/lib/ClosuresProvider";
import { Button } from "@/components/ui/button";

/**
 * Closures on a leg: why the route changed, and how to say a segment is blocked.
 *
 * Both sit inside the existing leg row rather than anywhere new. The report targets one segment
 * of the route the student is actually being shown, which is what keeps a locked tunnel from
 * closing a whole journey.
 */

/**
 * Why this route looks the way it does. Two different facts, and they must not be confused:
 * a route that went round a closure has been adjusted, while a Google route that still runs
 * along a closed path has not, because Google cannot be told to avoid a footpath.
 */
export function RouteAdjustedNote({ route }: { route: RouteOption }) {
  const avoided = route.avoidedClosures ?? [];
  const blocked = route.blockedBy ?? [];
  if (avoided.length === 0 && blocked.length === 0) return null;
  const name = (ids: string[]) => {
    const first = labelForEdgeId(NET, ids[0]);
    return ids.length > 1 ? `${first} and ${ids.length - 1} more` : first;
  };
  return (
    <p className="mt-1.5 text-xs text-warn">
      {avoided.length > 0 && (
        <>
          <span className="font-semibold">Route adjusted</span>
          {" · "}
          {name(avoided)} reported closed.
        </>
      )}
      {blocked.length > 0 && (
        <>
          {avoided.length > 0 && " "}
          <span className="font-semibold">Heads up</span>
          {" · "}
          this way still uses {name(blocked)}, reported closed.
        </>
      )}
    </p>
  );
}

interface Reportable {
  /** Every segment this entry covers. A stretch of path outside is several edges but one thing. */
  ids: string[];
  label: string;
}

/**
 * The parts of a route worth reporting, named so a student can tell them apart.
 *
 * Tunnels and bridges each join two buildings and stand alone. A path outside has no buildings
 * of its own, and a route can cross half a dozen of them in a row, so consecutive ones are
 * gathered into a single stretch named for the buildings either side of it. Reporting that
 * stretch reports every segment in it, which is how a hoarding across a path actually behaves.
 */
function reportableSegments(route: RouteOption): Reportable[] {
  const ids = route.indoorEdgeIds ?? [];
  const edges = ids.map((id) => ({ id, edge: edgeById(NET, id) }));
  /** The building this segment touches, if any; undefined for a segment wholly outside. */
  const buildingAt = edges.map(({ edge }) => {
    if (!edge) return undefined;
    const a = NET.nodes[edge.a].building;
    const b = NET.nodes[edge.b].building;
    return a !== "OUT" ? a : b !== "OUT" ? b : undefined;
  });
  const near = (i: number, step: -1 | 1) => {
    for (let j = i + step; j >= 0 && j < edges.length; j += step) if (buildingAt[j]) return buildingAt[j];
    return undefined;
  };

  const out: Reportable[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < edges.length; i++) {
    const { id, edge } = edges[i];
    if (!edge || seen.has(id)) continue;
    if (edge.kind === "TUNNEL" || edge.kind === "BRIDGE") {
      seen.add(id);
      out.push({ ids: [id], label: edgeLabel(NET, edge) });
      continue;
    }
    if (edge.kind !== "OUTDOOR") continue;
    // Gather this run of segments outside into one thing to report.
    const run: string[] = [];
    const from = near(i, -1);
    let j = i;
    for (; j < edges.length && edges[j].edge?.kind === "OUTDOOR"; j++) {
      if (!seen.has(edges[j].id)) { seen.add(edges[j].id); run.push(edges[j].id); }
    }
    const to = near(j - 1, 1);
    i = j - 1;
    if (run.length === 0) continue;
    const where = from && to && from !== to ? ` between ${[from, to].sort().join(" and ")}` : from ? ` by ${from}` : "";
    out.push({ ids: run, label: `Path outside${where}` });
  }
  return out;
}

/**
 * "Something blocked?" — one line per tunnel, bridge or walkway on this route. Reporting is one
 * tap and can be taken back; a segment only closes for everyone once enough different accounts
 * have said so, and the count is never attributed to anybody.
 */
export function ReportClosure({ route }: { route: RouteOption }) {
  const closures = useClosures();
  const [busy, setBusy] = useState<string | undefined>();
  const segments = reportableSegments(route);
  if (segments.length === 0) return null;

  const isReported = (s: Reportable) => s.ids.every((id) => closures.mine.has(id));
  /** The least-reported segment in the stretch: what still has to be agreed before it closes. */
  const remainingFor = (s: Reportable) => Math.max(...s.ids.map((id) => closures.remaining(id)));

  const toggle = async (s: Reportable) => {
    setBusy(s.label);
    const withdraw = isReported(s);
    for (const id of s.ids) {
      if (withdraw) await closures.withdraw(id);
      else await closures.report(id);
    }
    setBusy(undefined);
  };

  return (
    <details className="group mt-2" onClick={(e) => e.stopPropagation()}>
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-ink-muted [&::-webkit-details-marker]:hidden">
        <Construction className="size-3.5" aria-hidden="true" />
        Something blocked?
      </summary>
      <ul className="mt-1 space-y-1">
        {segments.map((s) => {
          const reported = isReported(s);
          const left = remainingFor(s);
          return (
            <li key={s.ids[0]} className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-ink-muted">{s.label}</span>
              <Button
                variant={reported ? "secondary" : "outline"}
                size="xs"
                disabled={busy === s.label}
                aria-pressed={reported}
                onClick={(e) => { e.stopPropagation(); void toggle(s); }}
              >
                {reported ? <><Check /> Reported</> : "Report closed"}
                {reported && left > 0 && <span className="font-normal text-ink-muted">{left} more needed</span>}
              </Button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
