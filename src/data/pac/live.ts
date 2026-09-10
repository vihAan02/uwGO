/**
 * Parser for the Warrior Rec member portal's Facility Occupancy page
 * (https://warrior.uwaterloo.ca/FacilityOccupancy). The page is server-rendered: one card
 * per facility with the name in <h2><strong>, and a canvas carrying data-occupancy (people)
 * and a "Max Occupancy: N" figure. There is no history on it, only "Live Results" and the
 * time they were taken ("Showing results from 10:02 PM").
 */
export interface PacZone { name: string; occupancy: number; capacity: number; pct: number }

export interface PacLive {
  fetchedAt: string;
  /** The portal's own "Showing results from" clock, when present. */
  resultsFrom?: string;
  zones: PacZone[];
  /** Capacity-weighted occupancy of the PAC fitness-centre zones, 0..100. */
  pacPct: number;
}

/** Fitness-centre zones that make up "how busy is PAC". Warrior Zone, CIF and the esports lounge are not the gym. */
export const PAC_FITNESS_ZONE = /^PAC - /i;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") return String.fromCodePoint(code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10));
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

export function parseFacilityOccupancy(html: string, fetchedAt = new Date()): PacLive {
  const zones: PacZone[] = [];
  const cards = html.split(/data-facilityid="/).slice(1);
  for (const card of cards) {
    const raw = /<h2>\s*<strong>([^<]+)<\/strong>/.exec(card)?.[1]?.trim();
    const name = raw ? decodeEntities(raw) : undefined;
    const occ = /data-occupancy="(\d+)"/.exec(card)?.[1];
    const cap = /Max Occupancy:\s*(?:<[^>]*>\s*)*(\d+)/.exec(card)?.[1];
    if (!name || occ === undefined || cap === undefined) continue;
    const occupancy = Number(occ);
    const capacity = Number(cap);
    zones.push({ name, occupancy, capacity, pct: capacity > 0 ? Math.round((occupancy / capacity) * 100) : 0 });
  }
  const pac = zones.filter((z) => PAC_FITNESS_ZONE.test(z.name));
  const capacity = pac.reduce((n, z) => n + z.capacity, 0);
  const occupancy = pac.reduce((n, z) => n + z.occupancy, 0);
  const resultsFrom = /Showing results from\s*(?:<[^>]*>\s*)*([0-9]{1,2}:[0-9]{2}\s*[AP]M)/i.exec(html)?.[1];
  return { fetchedAt: fetchedAt.toISOString(), resultsFrom, zones, pacPct: capacity ? Math.round((occupancy / capacity) * 100) : 0 };
}
