#!/usr/bin/env node
/**
 * Floor-plan ingestion: private plan images -> derived room metadata.
 *
 *   npm run ingest:floorplans            # every image under private/floorplans/raw
 *   node scripts/floorplans/ingest.mjs private/floorplans/raw/mc-2.png
 *
 * For each image: OCR locally (macOS Vision, scripts/floorplans/ocr.swift), read the
 * building and floor from the plan's title block, keep the room-number labels with their
 * normalised positions, and write src/data/floorplans/generated/rooms.json.
 * The images themselves are never copied anywhere public.
 *
 * Overrides (per-plan building/floor/orientation when the title block cannot be read) go
 * in private/floorplans/plans.json: { "<file name>": { "buildingCode": "MC", "floor": 2, "upBearingDeg": 0 } }
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const RAW = path.join(ROOT, "private/floorplans/raw");
const OVERRIDES = path.join(ROOT, "private/floorplans/plans.json");
const OUT = path.join(ROOT, "src/data/floorplans/generated/rooms.json");
const OCR = path.join(ROOT, "scripts/floorplans/ocr.swift");

const ORDINALS = { FIRST: 1, SECOND: 2, THIRD: 3, FOURTH: 4, FIFTH: 5, SIXTH: 6, SEVENTH: 7, EIGHTH: 8, NINTH: 9, TENTH: 10, GROUND: 0, BASEMENT: 0 };

// "BUILDING No. 17" in the title block is the campus building number, which the UW campus map
// data also carries (buildingId "017" = MC). That is far more reliable than matching a name,
// because the inset map on every plan names the neighbours too ("ENGINEERING 3" on DC's plan).
const BUILDING_BY_NUMBER = (() => {
  const src = readFileSync(path.join(ROOT, "src/data/buildings/uw-buildings.generated.ts"), "utf8");
  const map = new Map();
  for (const m of src.matchAll(/"code":"([A-Z0-9]+)","name":"[^"]*","alternateNames":\[[^\]]*\],"buildingId":"(\d+)"/g)) map.set(Number(m[2]), m[1]);
  return map;
})();

function ocr(file) {
  const json = execFileSync("swift", [OCR, file, "700", "3"], { maxBuffer: 64 * 1024 * 1024 }).toString();
  return JSON.parse(json);
}

function titleBlock(items) {
  const text = items.map((i) => i.text.toUpperCase());
  let floor;
  for (const t of text) {
    const m = /^(\w+)\s+FLOOR\s+PLAN/.exec(t);
    if (m && m[1] in ORDINALS) floor = ORDINALS[m[1]];
    const n = /^FLOOR\s+(\d+)/.exec(t);
    if (n) floor = Number(n[1]);
  }
  let buildingCode;
  for (const t of text) {
    const m = /BUILDING\s+NO\.?\s*(\d+)/.exec(t);
    if (m) buildingCode = BUILDING_BY_NUMBER.get(Number(m[1]));
  }
  return { floor, buildingCode };
}

function roomsFrom(items, buildingCode, floor) {
  const seen = new Map();
  for (const i of items) {
    const t = i.text.trim().toUpperCase();
    if (!/^\d{3,4}[A-Z]?$/.test(t)) continue;
    // A room's first digit is its floor (UW GO's floor rule); anything else on this plan is a misread.
    if (t.length === 4 && Number(t[0]) !== floor) continue;
    if (t.length === 3 && floor !== 0) continue;
    const prev = seen.get(t);
    if (!prev || i.conf > prev.conf) seen.set(t, { x: i.x, y: i.y, conf: i.conf });
  }
  return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([roomNumber, p]) => ({
    buildingCode, roomNumber, floor, floorPlanId: `${buildingCode.toLowerCase()}-floor-${floor}`,
    x: Number(p.x.toFixed(4)), y: Number(p.y.toFixed(4)), confidence: Number(p.conf.toFixed(2)),
  }));
}

const files = process.argv.slice(2).length
  ? process.argv.slice(2).map((f) => path.resolve(f))
  : existsSync(RAW) ? readdirSync(RAW).filter((f) => /\.(png|jpe?g|tiff?)$/i.test(f)).map((f) => path.join(RAW, f)) : [];
if (!files.length) { console.error(`No plan images found. Put them in ${RAW}.`); process.exit(1); }
const overrides = existsSync(OVERRIDES) ? JSON.parse(readFileSync(OVERRIDES, "utf8")) : {};

const existing = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { plans: [], rooms: [] };
const plans = new Map(existing.plans.map((p) => [p.id, p]));
const rooms = new Map(existing.rooms.map((r) => [`${r.buildingCode} ${r.roomNumber}`, r]));

for (const file of files) {
  const name = path.basename(file);
  process.stderr.write(`OCR ${name} … `);
  const { width, height, items } = ocr(file);
  const tb = titleBlock(items);
  const o = overrides[name] ?? {};
  const buildingCode = (o.buildingCode ?? tb.buildingCode ?? "").toUpperCase();
  const floor = o.floor ?? tb.floor;
  if (!buildingCode || floor === undefined) { process.stderr.write(`skipped: could not read building/floor (found ${JSON.stringify(tb)}); add an entry to ${OVERRIDES}\n`); continue; }
  const id = `${buildingCode.toLowerCase()}-floor-${floor}`;
  plans.set(id, { id, buildingCode, floor, upBearingDeg: o.upBearingDeg ?? plans.get(id)?.upBearingDeg ?? 0, source: `UW Plant Operations floor plan (WatIAM), OCR of ${name} ${width}x${height}` });
  for (const r of roomsFrom(items, buildingCode, floor)) rooms.set(`${r.buildingCode} ${r.roomNumber}`, r);
  process.stderr.write(`${buildingCode} floor ${floor}: ${roomsFrom(items, buildingCode, floor).length} rooms\n`);
}

mkdirSync(path.dirname(OUT), { recursive: true });
const out = { plans: [...plans.values()].sort((a, b) => a.buildingCode.localeCompare(b.buildingCode) || a.floor - b.floor), rooms: [...rooms.values()].sort((a, b) => a.floorPlanId.localeCompare(b.floorPlanId) || a.roomNumber.localeCompare(b.roomNumber)) };
writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
console.error(`Wrote ${out.rooms.length} rooms on ${out.plans.length} plans to ${path.relative(ROOT, OUT)}`);
