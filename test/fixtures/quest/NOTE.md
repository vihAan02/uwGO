# Quest paste fixtures

The `uwflow-*.txt` files are real captured Quest pastes from the UWFlow project
(https://github.com/UWFlow/uwflow, `flow/api/parse/schedule/testdata/` and `regtest/fixtures/`),
licensed MIT, Copyright (c) 2025 UW Flow. See `THIRD_PARTY_NOTICES.md`.
The only modification: the student's display name line in the page chrome was replaced with
`Student Name`.

| File | Term | Shape | Why it matters |
|---|---|---|---|
| uwflow-2013-spring-old-ui.txt | Spring 2013 | List View, tab-separated, heavy tab noise, `Grade` column era | MM/DD/YYYY; blank Days line + TBA room; `MC   4040` internal spaces; SEM/PRJ components |
| uwflow-2019-fall-listview.txt | Fall 2019 | List View, tabs | DD/MM/YYYY; TST rows with single-day ranges |
| uwflow-2020-winter-listview-continuation.txt | Winter 2020 | List View, tabs | MM/DD/YYYY; SYDE 556 continuation row (second meeting pattern with no class nbr) |
| uwflow-2021-fall-online-longclassnbr.txt | Fall 2021 | List View, tabs | YYYY/MM/DD; 5-digit class numbers; `ONLN - Online`; blank Days line; many instructors |
| uwflow-2025-fall-listview-spaces.txt | Fall 2025 | List View, **4-space** separators | DD/MM/YYYY; `TBA` days + online room; `MC 2065` |
| uwflow-2019-fall-homepage-widget*.txt | Fall 2019 | Student Center homepage widget (wrong page) | Must be detected and rejected, not parsed |

`synthetic-*.txt` files are written by us for edge cases not covered by real captures.
