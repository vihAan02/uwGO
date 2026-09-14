# Field observations

Observations imported from `/dev/campus-audit` exports, one JSON file per import
(`YYYY-MM-DD-<verifier>.json`, schema `uwgo.field-observations/1`). Add them with
`node scripts/campus-field.mjs import EXPORT.json`; never edit them by hand.

Nothing in this directory is read by routing. An observation reaches a route only through a
reviewed entry in `../promotions.ts`. See `../README.md`.
