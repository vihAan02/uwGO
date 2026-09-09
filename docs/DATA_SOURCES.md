# UW GO — Data sources and external APIs

Every external dataset or API the product depends on, with source, licence posture, reliability, and whether it is static or dynamic. Research date 2026-09-08. "Verified" means the primary source was read directly during Phase 0.

## 1. Schedule input

| Source | What we use | URL | Licence / terms | Static or dynamic | Reliability notes |
|---|---|---|---|---|---|
| UW Quest "My Class Schedule → List View" copied text | The only input for UW classes | quest.pecs.uwaterloo.ca (student login) | Student's own data, parsed in-browser, never uploaded | Dynamic per student; page format has been stable 2013→2026 but UW changes it "with no versioning and no notice" (UWFlow) | Verified from 7 real fixtures (2013–2025) and UWFlow's live 2026 code. Date order varies by student (MM/DD/YYYY, DD/MM/YYYY, YYYY/MM/DD); column separators are tabs or 4 spaces; continuation rows omit Class Nbr/Section/Component. Parser anchors on content, never on line offsets. |
| WLU LORIS "Student Detail Schedule" | Not parsed in V1 | loris.wlu.ca | Student's own data | Dynamic | LORIS is Ellucian Banner. Print-only; no ICS export found in official docs. Copy format unverified without a Laurier login. Manual entry in V1. |

## 2. Reference implementations studied (no code copied unless noted)

| Repo | Licence | What we took |
|---|---|---|
| github.com/UWFlow/uwflow (backend) | MIT (verified, "Copyright (c) 2025 UW Flow") | 5 real Quest paste fixtures + 2 regtest fixtures, vendored into `test/fixtures/quest/` with attribution in `THIRD_PARTY_NOTICES.md`. Term-id scheme `(year−1900)*10 + {1,5,9}` and `M/T/W/Th/F/S/Su` day codes reimplemented. Its parser only extracts term + class number + room and joins against its own course DB, so the parsing strategy itself is not reusable for us. |
| github.com/UWFlow/uwflow_frontend | MIT (verified) | Error-message taxonomy and three-layer validation idea (cheap pre-check → coarse error → specific message). Onboarding copy pattern. No code copied. |
| github.com/rawsab/quest-schedule-exporter | GPLv3 (verified) | Behavioural reference only (regex island approach, 6-way date format dropdown). No code copied. |
| github.com/Trinovantes/Quest-Schedule-Exporter, mchoo7 extension | AGPLv3 | Behavioural reference only. |
| github.com/justin13888/quest-schedule-exporter | MPL-2.0 | Reference; its fixed-7-line parser drops continuation rows, which is the bug class we test against. |
| github.com/rickytang666/quest2cal | MIT (verified) | UW building code → name table used to cross-check our registry names. Fail-closed parsing philosophy. |
| github.com/YINOL1/quest-schedule-exporter | MIT | Evidence that Quest dates are not always zero-padded. |
| github.com/kyle-qi/quest-calendar-exporter | **No licence** (all rights reserved) | Read only for DOM-shape understanding. Its HTML fixture is synthetic and contradicts real pastes; not used. |

## 3. Building and location data

| Source | What we use | URL | Licence / terms | Static or dynamic | Reliability |
|---|---|---|---|---|---|
| UW campus map ArcGIS Buildings feature service | Building code, name, alternate names, parent code, centroid lat/lng for 223 UW records; seeded into `src/data/buildings/uw.ts` | services5.arcgis.com/z87D0RdgTttiUQbV/arcgis/rest/services/BuildingsView/FeatureServer/0 (backing data of uwaterloo.ca/map) | No explicit licence. UW Open Data posture: "as-is", governed by Policy 46. Attribute as "Building data: University of Waterloo campus map, used as-is". | Static snapshot committed; re-pull occasionally | Verified live query 2026-09-08. Duplicates for BMH/CGR/MKV/REV/UTD (parent row chosen). E7 renamed to PSE (alias kept). STP no longer exists (now UTD). "DP" is not a code (Dana Porter = LIB). |
| UW Open Data API v3 `/v3/Locations` | Same schema as above; optional refresh source | openapi.data.uwaterloo.ca/v3 (X-API-KEY, free registration) | Same as above | Static-ish | Not called at runtime. Note `ClassSchedules.locationName` is redacted "for privacy", so the API cannot verify rooms. |
| UW public PDFs / pages for floor rules | Floor rule for PSE/E7 (first digit = floor, verified from the E7 booking PDF) | uwaterloo.ca/engineering-7-event-space/... | Public page | Static | Plant Operations floor plans need WatIAM login; all other UW floor rules are unverified and reported as unknown. MC is marked "likely" from one public data point and shown as unconfirmed. |
| WLU "How to find your classes", "Find your exam room", "Classrooms", "Building hours" pages | WLU building codes, names, street addresses, room-numbering rules, residence list | students.wlu.ca/news/recurring/how-to-find-your-classes.html; .../find-your-exam-room.html; students.wlu.ca/campus-services/classrooms-and-spaces/classrooms/index.html; wlu.ca/campus-status/building-hours.html | University web pages, © WLU. Facts only (names, addresses, codes). | Static | Verified. The two code legends overlap but are not identical; registry is a maintained table, not an enum. Most academic buildings share the address 75 University Ave W, so address geocoding cannot distinguish them. |
| OpenStreetMap (Nominatim/Overpass) | Centroids for WLU buildings with no official coordinate source (LH, BA, DAWB, FNCC, Bricker Residence, Waterloo College Hall) | openstreetmap.org | **ODbL 1.0** — attribution "© OpenStreetMap contributors" required in the UI | Static snapshot | Verified per building. Peters, Science Building, Willison Hall had no distinct OSM match; they are in the registry with `coordinatesSource: 'unverified'` and excluded from routing until a coordinate is added. |
| WLU Concept3D interactive map | Not used | map.concept3d.com/?id=638 | No visible licence, gated API | — | Not scrapable, not licence-clear. |

## 4. Routing and maps

| Source | What we use | URL | Billing / terms (verified 2026-09-08) | Static or dynamic |
|---|---|---|---|---|
| Google Routes API `computeRoutes` (REST, server-side) | WALK durations/distances/polylines between building pairs; TRANSIT itineraries with `departureTime` and `transitDetails` | routes.googleapis.com/directions/v2:computeRoutes | Compute Routes **Essentials** for both WALK and TRANSIT: $5.00/1000 after 10,000 free requests per month. Field mask required. Terms: Routes lat/lng cacheable **≤30 consecutive days** (Service Specific Terms §19.3); no caching beyond that; results may only be displayed on a Google map (ToS §3.2.3(e)). Directions/Distance Matrix APIs are Legacy (Mar 2025) and Deprecated (Feb 2026); not used. | Walking: cached per building pair with 30-day TTL. Transit: time-dependent, cached per (pair, departure minute) for the session only. |
| Google Maps JavaScript API (`@vis.gl/react-google-maps`) | Map rendering, markers, polyline | maps.googleapis.com | Dynamic Maps Essentials: $7.00/1000 map loads after 10,000 free/month. Map ID optional; used for AdvancedMarker. Browser key restricted by HTTP referrer + API restriction. | Dynamic per map load. Map is collapsed by default to save loads. |
| Google Geocoding API (server-side) | One-time geocode of a custom home address | maps.googleapis.com/maps/api/geocode/json | Essentials: $5.00/1000 after 10,000 free/month. §6.3.2 allows indefinite caching of the result for the end user who requested it; we store it only in that user's localStorage. | One call per home change. |
| The old $200/month credit | — | — | Expired 2025-02-28; budget only against per-SKU free quotas. | — |

Cost model (from research): 1,000 weekly-active students, 15 transitions each, without caching ≈ $357/month; with per-building-pair walking cache ≈ $82/month, all of it map loads. Transit requests are per transition per day and are the next line item to watch.

## 5. Transit reference data (not called at runtime in V1)

| Source | URL | Licence | Notes |
|---|---|---|---|
| GRT GTFS static (bus feed 1, LRT feed 2) and GTFS-RT | webapps.regionofwaterloo.ca/api/grt-routes/ | Region of Waterloo Open Data Licence v2.0: commercial use allowed, attribution optional | Verified reachable. Would power a self-hosted OpenTripPlanner fallback provider if Google pricing becomes a problem. Bus and LRT are separate feeds; "Willis Way" and "Waterloo Public Square" are the same stop in different directions. |
| GRT route facts | grt.ca schedule PDFs | Same | Only routes **202 iXpress University** and **19 Hazel** link a UW stop to a Laurier stop directly. ION ride UW station → Laurier–Waterloo Park is 1–2 min scheduled; peak every 10 min weekdays. |
| U-Pass | grt.ca, wusa.ca | — | Full-time UW and WLU students have fares covered. Fare is not a factor in recommendations. |

## 6. Time zone data

| Source | Use | Notes |
|---|---|---|
| IANA tz `America/Toronto` via `@date-fns/tz` (`TZDate`) | All wall-clock arithmetic | Never use the developer's machine zone. DST transition tests (second Sunday in March, first Sunday in November) are part of the test suite. |

## 7. What leaves the browser

| Data | Leaves? | To whom | Why |
|---|---|---|---|
| Raw Quest paste | **No** | — | Parsed locally. Never logged, never sent to analytics (there is no analytics). |
| Course codes, titles, instructors, class numbers | **No** | — | Stay in localStorage. |
| Building coordinates + departure time for a transition | Yes | Our `/api/routes` handler → Google Routes API | Needed to compute a route. Coordinates identify a building, not a person. |
| Home coordinate | Yes, when a transition starts or ends at home | Same path | Needed to route to/from home. The address string itself is only sent to Geocoding once, at setup. |
| Custom home address text | Yes, once | Our `/api/geocode` handler → Google Geocoding API | To obtain a coordinate. Not stored server-side. |
| Map tiles / viewport | Yes | Google Maps JS API directly from the browser | Only when the student expands the map. |

Server handlers keep no logs of request bodies. The walking-route cache stores building-pair keys and route geometry, never user identifiers.
