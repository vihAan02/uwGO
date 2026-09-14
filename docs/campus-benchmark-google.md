# Campus-aware walk benchmark on real Google walks

What the campus-aware walk decides for every ordered pair of 48 campus places (the 40 buildings on the indoor network and the 8 residences off it, 2,256 trips), with Google's real walks in place of the stand-in. Run on 2026-09-14 against branch `feat/campus-pedestrian-graph`; floors unknown (a trip starts and ends on whichever floor suits it), Tuesday noon.

## How it was run

```bash
UWGO_CAMPUS_WALKS=walks.json UWGO_CAMPUS_FETCH=1 UWGO_CAMPUS_EXACT=1 UWGO_CAMPUS_PREFETCH=1 UWGO_CAMPUS_ALL_DOORS=1 npm run campus:benchmark
```

- Google's walk for both directions of every pair (2,256), and every walk from a place to a door of another building (2,021): 4,283 Routes API walking requests, each made once. The table stays out of the repository: Google allows a route to be kept for thirty days, and the tool drops older entries.
- The two directions of a walk are not the same: over all 1,128 pairs they differ by a median 13 s, 90th percentile 40 s, at most 71 s (651 pairs by more than 10 s). So every direction was fetched, not served reversed.
- `UWGO_CAMPUS_EXHAUSTIVE=1` asks for every door walk that could change a decision: the reference the pruning is judged against. With the table filled, every other run makes no requests; deciding all 2,256 trips takes 11.5 s.

## The engines

| | Old engine (b17a241) | Floor to floor, before pruning changes (5230b59) | Now | Every door walk asked |
|---|---|---|---|---|
| Google's walk kept | 2,051 | 1,060 | 951 | 888 |
| Corrected (PAC's exit-only doors) | 47 | 47 | 47 | 47 |
| Shortcut through a building or by a link | 102 | 387 | 473 | 503 |
| By a better door | 0 | 762 | 785 | 818 |
| Not decided (both ends off the network) | 56 | 0 | 0 | 0 |
| Seconds saved, of what asking every door walk saves | 11.3 % | 86.0 % | 93.4 % | 100 % (112,622 s) |
| Corrections longer than the best allowed | 38 | 4 | 2 | 0 |
| Door walks asked per trip, mean / worst | 0.10 / 5 | 1.61 / 7 | 1.35 / 4 | 20.4 / 76 |
| Trips with at most two door walks | 97.9 % | 75.8 % | 97.5 % | 20.7 % |

Now, against the old engine: 1,261 trips change; floor to floor 1,193 are faster, 56 within a second, 12 slower. The slower ones are three PAC corrections whose old route timed a survey walkway faster than Google walks it (BMH, CLN, OPT to PAC), two corrections the pruning misses (REV and MHR to PAC, 38 s and 3 s), DC to EXP both ways (21 s slower, with fewer uncertain crossings), and five within 4 s. Savings over a usable Google walk: mean 84 s, median 66 s, 90th percentile 158 s, most 354 s (C2 to EXP by the C2–MC tunnel). 475 routes pass through a building, 149 use a bridge and 78 a tunnel.

The time a leg shows is longer on 258 changed trips, 256 of them only because a campus route is timed from the floor and Google's walk from map point to map point.

## Guessing a door walk before asking

Against the 2,021 real door walks, a walk to a door guessed from the trip's own Google walk (its line as far as the nearest point, then across at Google's pace):

| Door's distance from Google's line | Guessed off the line (median / 90th percentile error) | Straight line × the trip's detour |
|---|---|---|
| up to 15 m | 9 s / 19 s | 23 s / 67 s |
| 15–30 m | 14 s / 30 s | 27 s / 84 s |
| 30–60 m | 20 s / 69 s | 35 s / 118 s |
| over 60 m | 87 s / 245 s | 54 s / 161 s |

Google walks at 1.22 m/s on campus (median). No door walk came in under the straight line less 60 m at 1.4 m/s. A door within 15 m of Google's line is now read off the line with no request; the routes the old pruning missed were mostly doors 15–60 m off the line whose straight-line guess was too long.

## The margin

Exhaustive searches under each margin (routes taken, seconds saved). Every row but the first counts every building a route passes through, as the margin did before the cap:

| Margin | Taken | Saved |
|---|---|---|
| **10 s + 2 % + 15 s a building, at most three (now)** | 1,321 | 112,622 s |
| 10 s + 2 % + 15 s a building, every building | 1,317 | 112,120 s |
| none | 1,566 | 118,040 s |
| 5 s + 2 % + 15 s a building | 1,397 | 114,012 s |
| 15 s + 2 % + 15 s a building | 1,230 | 109,765 s |
| 20 s + 2 % + 15 s a building | 1,142 | 106,871 s |
| 10 s + 0 % + 15 s a building | 1,479 | 115,841 s |
| 10 s + 5 % + 15 s a building | 1,019 | 100,076 s |
| 10 s + 2 % + 30 s a building | 1,261 | 107,604 s |

Every positive saving, by kind: by the door Google's walk itself uses, median 49 s, 165 of 663 under 20 s; by another door, median 57 s, 2 of 325 under 20 s; by a bridge or tunnel alone, median 58 s; through one building, median 88 s; through two or more, median 85 s. A lower margin only adds refinements of Google's own approach worth a few seconds, within Google's own difference between directions. Counting the uncertainty hedges against the saving would drop 180 routes, mostly doors; charging bridges and tunnels 10 s more drops 19. Charging no more than three buildings takes seven long chains the uncapped margin refused, worth 63–115 s each (STC to E6 through eight buildings, 115 s).

## Lines on the map

Every chosen route's line passes through every door, link and corridor it names, in order (1,305 routes). Straight pieces remain where the data has nothing better: from the end of a Google door walk to the door (median 12 m, most 37 m) and from a building's map point to its point on the network (median 25 m, most 68 m; 88 of them cross a surveyed outdoor path).

## The largest savings by what they use

| Uses | Trips | Best trip | Google, and floor to floor | UW Go | Saved | Weakest evidence |
|---|---|---|---|---|---|---|
| C2–MC tunnel, through MC | 6 | C2 to EXP | 648 s (688 s) | 334 s | 354 s | surveyed |
| Through BMH | 49 | MC to OPT | 706 s (758 s) | 452 s | 306 s | surveyed |
| Through SLC | 69 | PAC to EXP | 392 s (432 s) | 143 s | 289 s | surveyed |
| QNC–B2 and MC–QNC bridges | 8 | B1 to EXP | 661 s (701 s) | 417 s | 284 s | surveyed |
| B1–B2 corridor | 2 | B2 to ESC | 321 s | 65 s | 256 s | corroborated |
| DWE–E2 bridge | 2 | DWE to E2 | 214 s (324 s) | 90 s | 234 s | surveyed |
| EV1–HH tunnel | 2 | EV1 to HH | 172 s (265 s) | 89 s | 176 s | corroborated |
| SLC–MC bridge | 2 | SLC to MC | 197 s (299 s) | 138 s | 161 s | corroborated |
| ML–EV1 tunnel, through ML | 37 | EV1 to V1 | 752 s (866 s) | 743 s | 123 s | surveyed |
| AL–EV1 tunnel | 2 | EV1 to AL | 46 s (155 s) | 80 s | 75 s | surveyed |

Nothing here rests on an anecdotal or unresolved link: the research leads stay inactive.
