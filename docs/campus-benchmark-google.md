# Campus-aware walk benchmark on real Google walks

What the campus-aware walk decides for every ordered pair of 48 campus places (the 40 buildings on the indoor network and the 8 residences off it, 2,256 trips), with Google's real walks in place of the stand-in. Run on 2026-09-14 against branch `feat/campus-pedestrian-graph`; floors unknown (a trip starts and ends on whichever floor suits it), Tuesday noon. The latest run, after the pass that made one trip timed, chosen and drawn the same way, comes first; the first run, which set how door walks are pruned, follows.

## How it was run

```bash
UWGO_CAMPUS_WALKS=walks.json UWGO_CAMPUS_FETCH=1 UWGO_CAMPUS_EXACT=1 UWGO_CAMPUS_PREFETCH=1 UWGO_CAMPUS_ALL_DOORS=1 npm run campus:benchmark
UWGO_CAMPUS_WALKS=walks.json UWGO_CAMPUS_FETCH=1 UWGO_CAMPUS_EXACT=1 npm run campus:benchmark
UWGO_CAMPUS_WALKS=walks.json UWGO_CAMPUS_EXHAUSTIVE=1 npm run campus:benchmark
```

- First run: Google's walk for both directions of every pair (2,256), and every walk from a place to a door of another building (2,021): 4,283 Routes API walking requests, each made once. The table stays out of the repository: Google allows a route to be kept for thirty days, and the tool drops older entries.
- The two directions of a walk are not the same: over all 1,128 pairs they differ by a median 13 s, 90th percentile 40 s, at most 71 s (651 pairs by more than 10 s). So every direction was fetched, not served reversed.
- Latest run: door walks are priced in the direction walked, so the walks from a door to a place that the engine asks for were fetched: 803 more requests, and nothing else. `UWGO_CAMPUS_EXACT=1` serves each direction as its own walk.
- `UWGO_CAMPUS_EXHAUSTIVE=1` asks for every door walk that could change a decision: the reference the pruning is judged against. For the latest run it was not given its own return walks: 14,316 of the walks it asked for (a walk from a door to a place nobody's decision needed) were served as the walk the other way, reversed. That is an approximation for the reference only; it decides nothing a student sees.

## One trip, timed, chosen and drawn the same way

What changed is how a trip is measured and drawn, not the campus data:

- Google's walk is timed floor to floor as well, joined to its buildings at a usable door within 15 m of its line (otherwise taken from its own end and charged from the door nearest it), and that is the time a leg shows, plans with and is compared by. A bus is timed the same way.
- Every door walk is priced in the direction it is walked.
- A straight step between one of Google's lines and a door may not cut a surveyed path, corridor or link more than 3 m from its ends.
- A correction prices its legal ways in whatever their guesses, up to four door walks; an option (a way to spend a gap) asks for no new door walk unless it corrects a walk into PAC.

| | Before the pass (cc9000a) | Now | Every door walk asked, now |
|---|---|---|---|
| Google's walk kept | 951 | 1,452 | 1,374 |
| Corrected (PAC's exit-only doors) | 47 | 47 | 47 |
| Shortcut through a building or by a link | 473 | 386 | 411 |
| By a better door | 785 | 371 | 424 |
| Seconds saved, of what asking every door walk saves | 93.4 % | 91.1 % (99.8 % over the 534 trips whose reference used no reversed walk) | 100 % (79,769 s) |
| Corrections into PAC longer than the best allowed | 2 | 0 | 0 |
| Door walks asked per trip, mean / worst | 1.35 / 4 | 1.34 / 4 | 24.5 / 76 |
| Trips with at most two door walks | 97.5 % | 96.9 % | 14.9 % |
| Taken routes showing longer than Google's walk as shown | 263 | 0 | |
| Straight joins drawn to a building's map point | 1,487 (longest 68 m) | 0 | |

Better doors fall by half because a door on Google's own line is now Google's walk, timed floor to floor through that door, rather than a better door than Google's walk to the map point. Savings over a usable Google walk: 757 routes, mean 96 s, median 79 s, 90th percentile 174 s, most 354 s (C2 to EXP by the C2–MC tunnel). 385 routes pass through a building, 119 use a bridge and 50 a tunnel.

572 trips change route. Floor to floor against the old engine's own estimate, 83 are faster, 307 within a second and 182 slower (median 35 s). Of those 182: 57 relied on an exit timed as the walk to the door reversed, and the walk from the door is longer (by up to 54 s); 13 relied on a door walk or join drawn with a straight step that cut a path or a building; 68 no longer save their margin once Google's walk is joined at its own door; 12 now reach a door the old walk to it reached only across a path, by another way; and 32 have a quicker route in the exhaustive reference, most of them on return walks it serves reversed. On the same route, the timing moves by a median 0 s (90th percentile 12 s, most 49 s).

Every correction into PAC now reaches the reference's best allowed route. REV and MHR to PAC had missed it by 48 s and 13 s, because a guess for a far door ruled out the door that won. Of the 38 corrections that need a door walk, the way taken was the first asked in 16, the second in 16 and the third in 6, so corrections stop at four. V1 to PAC keeps its route (SLC east doors, through SLC, the front desk): 473 s floor to floor, against 501 s before, because Google's walk from V1 passes V1's east doors and is now joined there.

## Lines on the map

Every line is checked piece by piece (`checkDrawing`). For 2,256 decisions, no piece is joined to a building's map point, no named door, link or corridor is off the line, and no step across cuts a surveyed path or building or reaches a door from inside. The 1,512 steps across between Google's lines and doors are 9 m in the median, 16 m at the 90th percentile and 33 m at most (B1 to EV1, where Google's walk to the EV1 door stops short). Of the 3,760 building ends on the network, 1,882 start or end on the floor's own point on the network. The other 1,878 start or end where Google's own line does, because no usable door lies within 15 m of that line: their inside is charged from the door nearest the line's end but not drawn. The remaining 752 ends are residences off the network. Before the pass, a building's map point was joined to the network by a straight stub on 1,487 ends (longest 68 m), and walks to doors by joins up to 37 m.

## The seeded schedule

UW Place, then MC 2065, then DC 1350, then the gym, planned on a cold route cache over the same table of walks.

| | Before the pass | Now |
|---|---|---|
| Google's walks between places | 6 | 6 (4 for the gap's options) |
| Door walks | 10 (5 for the gap's options, 2 of them later reused by the itinerary) | 7 (none for the gap's options) |
| Winter-route joins | 2 | 2 |
| Transit | 3 | 3 |
| Requests in all | 21 | 18 |

Planned again on the warm cache, no walk is asked for again. The replay answers transit with nothing, which is never cached, so its three transit requests repeat. The legs: UW Place to MC 2065 in 750 s (Google's walk 733 s), in by MC's north doors; MC 2065 to DC 1350 in 124 s (Google's walk 180 s), out by MC's north doors; DC 1350 to PAC in 395 s (Google's walk, 466 s, ends at PAC's exit-only doors), in through SLC.

## The first run: pruning door walks

| | Old engine (b17a241) | Floor to floor, before pruning changes (5230b59) | After (cc9000a) | Every door walk asked |
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

Against the old engine: 1,261 trips change; floor to floor 1,193 are faster, 56 within a second, 12 slower. The slower ones are three PAC corrections whose old route timed a survey walkway faster than Google walks it (BMH, CLN, OPT to PAC), two corrections the pruning missed (REV and MHR to PAC), DC to EXP both ways (21 s slower, with fewer uncertain crossings), and five within 4 s.

### Guessing a door walk before asking

Against the 2,021 real door walks, a walk to a door guessed from the trip's own Google walk (its line as far as the nearest point, then across at Google's pace):

| Door's distance from Google's line | Guessed off the line (median / 90th percentile error) | Straight line × the trip's detour |
|---|---|---|
| up to 15 m | 9 s / 19 s | 23 s / 67 s |
| 15–30 m | 14 s / 30 s | 27 s / 84 s |
| 30–60 m | 20 s / 69 s | 35 s / 118 s |
| over 60 m | 87 s / 245 s | 54 s / 161 s |

Google walks at 1.22 m/s on campus (median). No door walk came in under the straight line less 60 m at 1.4 m/s. A door within 15 m of Google's line is read off the line with no request; the routes the old pruning missed were mostly doors 15–60 m off the line whose straight-line guess was too long.

### The margin

Exhaustive searches under each margin (routes taken, seconds saved). Every row but the first counts every building a route passes through, as the margin did before the cap:

| Margin | Taken | Saved |
|---|---|---|
| **10 s + 2 % + 15 s a building, at most three (in force)** | 1,321 | 112,622 s |
| 10 s + 2 % + 15 s a building, every building | 1,317 | 112,120 s |
| none | 1,566 | 118,040 s |
| 5 s + 2 % + 15 s a building | 1,397 | 114,012 s |
| 15 s + 2 % + 15 s a building | 1,230 | 109,765 s |
| 20 s + 2 % + 15 s a building | 1,142 | 106,871 s |
| 10 s + 0 % + 15 s a building | 1,479 | 115,841 s |
| 10 s + 5 % + 15 s a building | 1,019 | 100,076 s |
| 10 s + 2 % + 30 s a building | 1,261 | 107,604 s |

Every positive saving, by kind: by the door Google's walk itself uses, median 49 s, 165 of 663 under 20 s; by another door, median 57 s, 2 of 325 under 20 s; by a bridge or tunnel alone, median 58 s; through one building, median 88 s; through two or more, median 85 s. A lower margin only adds refinements of Google's own approach worth a few seconds, within Google's own difference between directions. Counting the uncertainty hedges against the saving would drop 180 routes, mostly doors; charging bridges and tunnels 10 s more drops 19. Charging no more than three buildings takes seven long chains the uncapped margin refused, worth 63–115 s each (STC to E6 through eight buildings, 115 s).

### The largest savings by what they use

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
