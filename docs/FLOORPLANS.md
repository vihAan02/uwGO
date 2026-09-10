# Floor plans: from WatIAM files to "Floor 2 · east side"

UW Plant Operations publishes floor plans for most buildings behind a WatIAM login
(uwaterloo.ca/plant-operations/floor-plans). UW GO never touches WatIAM. The owner logs in
themselves, downloads or screenshots the plans, and drops the files here:

```
private/floorplans/raw/        <- plan images (PNG/JPG; one floor per image). gitignored.
private/floorplans/plans.json  <- optional per-file overrides, e.g.
                                  { "mc-2.png": { "buildingCode": "MC", "floor": 2, "upBearingDeg": 330 } }
```

Then:

```bash
npm run ingest:floorplans
```

What it does, all on this machine:

1. OCR each image with macOS Vision (`scripts/floorplans/ocr.swift`), in overlapping
   upscaled tiles so the small room labels are readable.
2. Read the building and floor from the plan's title block ("SECOND FLOOR PLAN",
   "MATHEMATICS AND COMPUTER"). If that fails, add the file to `plans.json`.
3. Keep every label that looks like a room number whose first digit matches the floor,
   with its normalised position (x right, y down, 0..1) and OCR confidence.
4. Write `src/data/floorplans/generated/rooms.json`: `{ plans: FloorPlanMeta[], rooms: RoomPosition[] }`.

That JSON is UW GO's own derived metadata (room -> floor -> approximate position) and is
committed. The source images stay in `private/` and are not served or redistributed. A plan
image is only ever shown in the app if the owner sets `imageUrl` on a plan after confirming
that is allowed.

The app reads it through `findRoomPosition(buildingCode, roomNumber)` and shows
"Floor 2 · east side" on class cards. The compass words come from the point's offset from the
plan centre rotated by the plan's `upBearingDeg` (the direction the plan's "up" points, in
degrees clockwise from north; 0 = north-up). Set it from the plan's north arrow when the plan
is not north-up; MC's plans are drawn about 30 degrees off.

Known limits: OCR misreads a few labels per plan (a "1083" read as "8083" is dropped by the
floor-digit rule; a misread that still starts with the right digit is kept, so check
`confidence`), and an image that is a photo rather than a clean render will read worse.
Re-run the script after replacing an image; results merge by room.
