import type { CampusBuilding, FloorRule } from "@/domain/types";

/**
 * Wilfrid Laurier University, Waterloo campus. Curated from official Laurier pages:
 *  - students.wlu.ca/news/recurring/how-to-find-your-classes.html (building codes, floor rule)
 *  - students.wlu.ca/news/recurring/find-your-exam-room.html (exam-room code legend)
 *  - students.wlu.ca/campus-services/classrooms-and-spaces/classrooms/index.html (real room numbers)
 *  - wlu.ca/campus-status/building-hours.html (street addresses)
 *  - students.wlu.ca/campus-services/residence-and-off-campus-housing/residence/buildings/index.html
 * Laurier publishes no licensed coordinate feed. Coordinates marked OSM are © OpenStreetMap contributors (ODbL),
 * queried from the Overpass API over the Laurier Waterloo campus bounding box on 2026-09-09.
 * Buildings without coordinates are kept for name resolution and excluded from routing.
 */

const FLOOR_SRC = "students.wlu.ca how-to-find-your-classes: 'The first numeral in a classroom listing indicates the building floor'";
const FIRST: FloorRule = { kind: "FIRST_DIGIT", confidence: "verified", source: FLOOR_SRC };
const DASH: FloorRule = { kind: "DASH_PREFIX", confidence: "verified", source: FLOOR_SRC + " (DAWB uses floor-room, e.g. DAWB 2-108)" };
const WING: FloorRule = { kind: "LEADING_DIGIT_THEN_WING", confidence: "verified", source: "classrooms/index.html lists Arts wing rooms as 1C16, 2C15, 1E1" };
const UNKNOWN: FloorRule = { kind: "UNKNOWN" };

const ADDR_75 = "75 University Ave W, Waterloo, ON N2L 3C5";

interface Row {
  code: string; name: string; aliases?: string[]; address?: string; kind: CampusBuilding["kind"];
  lat?: number; lng?: number; src?: "OSM"; floorRule?: FloorRule; residenceLabel?: string;
}

const ROWS: Row[] = [
  // Academic
  { code: "LH", name: "Lazaridis Hall", aliases: ["LAZ", "LAZARIDIS"], address: "64 University Ave W, Waterloo, ON", kind: "ACADEMIC", lat: 43.4750921, lng: -80.529488, src: "OSM", floorRule: FIRST },
  { code: "BA", name: "Bricker Academic Building", aliases: ["BAB", "BRICKER"], address: ADDR_75, kind: "ACADEMIC", lat: 43.4726853, lng: -80.5264849, src: "OSM", floorRule: FIRST },
  { code: "DAWB", name: "Dr. Alvin Woods Building", aliases: ["WOODS"], address: ADDR_75, kind: "ACADEMIC", lat: 43.4733018, lng: -80.529438, src: "OSM", floorRule: DASH },
  { code: "FNCC", name: "Fred Nichols Campus Centre", aliases: ["CONCOURSE"], address: ADDR_75, kind: "OTHER", lat: 43.4734562, lng: -80.5288406, src: "OSM", floorRule: UNKNOWN },
  { code: "P", name: "Frank C. Peters Building", aliases: ["PETERS"], address: ADDR_75, lat: 43.4736649, lng: -80.5306167, src: "OSM", kind: "ACADEMIC", floorRule: FIRST },
  { code: "N", name: "Science Building", aliases: ["SCIENCE"], address: ADDR_75, lat: 43.4732744, lng: -80.5252663, src: "OSM", kind: "ACADEMIC", floorRule: FIRST },
  { code: "SB", name: "Schlegel Building", aliases: ["SCHLEGEL"], address: ADDR_75, lat: 43.4732544, lng: -80.5302728, src: "OSM", kind: "ACADEMIC", floorRule: FIRST },
  { code: "MLU", name: "Martin Luther University College", aliases: ["LUTHER", "SEMINARY"], address: ADDR_75, lat: 43.4720269, lng: -80.5289384, src: "OSM", kind: "ACADEMIC", floorRule: FIRST },
  { code: "A", name: "Arts Building, A Wing", address: ADDR_75, lat: 43.4736989, lng: -80.5302469, src: "OSM", kind: "ACADEMIC", floorRule: WING },
  { code: "C", name: "Arts Building, C Wing", address: ADDR_75, lat: 43.4737234, lng: -80.5298548, src: "OSM", kind: "ACADEMIC", floorRule: WING },
  { code: "E", name: "Arts Building, E Wing", address: ADDR_75, lat: 43.4738203, lng: -80.5292751, src: "OSM", kind: "ACADEMIC", floorRule: WING },
  { code: "AH", name: "Alumni Hall", address: ADDR_75, lat: 43.4729617, lng: -80.5284222, src: "OSM", kind: "ACADEMIC", floorRule: UNKNOWN },
  { code: "M", name: "Savvas Chamberlain Music Building", aliases: ["MUSIC"], address: ADDR_75, kind: "ACADEMIC", floorRule: UNKNOWN },
  { code: "SRC", name: "Science Research Centre", address: ADDR_75, lat: 43.4730121, lng: -80.5259143, src: "OSM", kind: "ACADEMIC", floorRule: UNKNOWN },
  { code: "LIB", name: "Library", address: ADDR_75, lat: 43.4728736, lng: -80.5299644, src: "OSM", kind: "ACADEMIC", floorRule: UNKNOWN },
  { code: "AC", name: "Athletic Complex", address: "University Stadium and Athletic Complex", lat: 43.4752262, lng: -80.5257078, src: "OSM", kind: "OTHER", floorRule: UNKNOWN },
  { code: "R", name: "Regina Administration Building (202 Regina)", aliases: ["202R"], address: "202 Regina St N, Waterloo, ON", kind: "OTHER", floorRule: UNKNOWN },
  // Residences (Department of Residence properties, per Laurier's Buildings and Styles + Building Hours pages)
  { code: "BRICKER-RES", name: "Bricker Residence", address: "44 Bricker Ave, Waterloo, ON", kind: "RESIDENCE", lat: 43.4724649, lng: -80.5272476, src: "OSM", residenceLabel: "Bricker Residence" },
  { code: "WCH", name: "Waterloo College Hall", address: "88 Seagram Dr, Waterloo, ON", kind: "RESIDENCE", lat: 43.4714438, lng: -80.5319958, src: "OSM", residenceLabel: "Waterloo College Hall" },
  { code: "BOUCKAERT", name: "Bouckaert Hall", address: ADDR_75, lat: 43.4728796, lng: -80.5271393, src: "OSM", kind: "RESIDENCE", residenceLabel: "Bouckaert Hall" },
  { code: "LITTLE", name: "C.H. Little House", address: ADDR_75, lat: 43.4733223, lng: -80.5277418, src: "OSM", kind: "RESIDENCE", residenceLabel: "Little House" },
  { code: "CONRAD", name: "Clara Conrad Hall", address: ADDR_75, lat: 43.4748824, lng: -80.5268844, src: "OSM", kind: "RESIDENCE", residenceLabel: "Conrad Hall" },
  { code: "EULER", name: "Euler Residence", address: ADDR_75, lat: 43.4729303, lng: -80.5279488, src: "OSM", kind: "RESIDENCE", residenceLabel: "Euler Residence" },
  { code: "LEUPOLD", name: "Leupold Residence", address: ADDR_75, lat: 43.4726413, lng: -80.5282145, src: "OSM", kind: "RESIDENCE", residenceLabel: "Leupold Residence" },
  { code: "MACDONALD", name: "Macdonald House", address: ADDR_75, lat: 43.4737442, lng: -80.5279327, src: "OSM", kind: "RESIDENCE", residenceLabel: "Macdonald House" },
  { code: "WILLISON", name: "Willison Hall", address: ADDR_75, lat: 43.4736678, lng: -80.5267192, src: "OSM", kind: "RESIDENCE", residenceLabel: "Willison Hall" },
  { code: "KSR", name: "King Street Residence", address: "200 King St N, Waterloo, ON", lat: 43.47448, lng: -80.524123, src: "OSM", kind: "RESIDENCE", residenceLabel: "King Street Residence" },
  { code: "UPLACE", name: "University Place", address: "50 University Ave E, Waterloo, ON", kind: "RESIDENCE", residenceLabel: "University Place" },
];

export const WLU_BUILDINGS: readonly CampusBuilding[] = ROWS.map((r) => ({
  id: `WLU:${r.code}`,
  university: "WLU",
  code: r.code,
  name: r.name,
  aliases: r.aliases ?? [],
  latitude: r.lat,
  longitude: r.lng,
  coordinatesSource: r.src ?? "UNVERIFIED",
  address: r.address,
  kind: r.kind,
  floorRule: r.floorRule ?? UNKNOWN,
  residenceLabel: r.residenceLabel,
}));
