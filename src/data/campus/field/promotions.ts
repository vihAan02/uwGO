/**
 * Field observations deliberately promoted into routing facts. Empty until someone has walked a check
 * and a reviewer has decided what it supports. Nothing captured in the field reaches routing any other
 * way: the capture page and the imported observations are never read by the router.
 *
 * To promote (see README.md in this directory):
 * 1. `node scripts/campus-field.mjs import EXPORT.json` adds the phone's export to `observations/`.
 * 2. `node scripts/campus-field.mjs review TARGET_ID` shows what the observations support, what
 *    contradicts them, and a draft entry.
 * 3. `UWGO_ROUTES_OUT=before.json npm run campus:regression` saves every route first.
 * 4. Add the entry below. `npx vitest run src/data/campus` checks each claim against the observations.
 * 5. `UWGO_ROUTES_BEFORE=before.json npm run campus:regression` lists every route the promotion changed.
 *
 * Type-only imports: Node loads this file for the scripts.
 */
import type { FieldPromotion } from "./types";

export const FIELD_PROMOTIONS: readonly FieldPromotion[] = [];
