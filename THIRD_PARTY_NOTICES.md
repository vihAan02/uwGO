# Third-party notices

## UWFlow (MIT)
Test fixtures under `test/fixtures/quest/uwflow-*.txt` are copied from https://github.com/UWFlow/uwflow.

The Courses timetable is adapted from the UW Flow frontend, https://github.com/UWFlow/uwflow_frontend
(read at commit `1f95a45`). The following UW Go files contain code adapted from it, and are covered by
the MIT notice below:

| UW Go file | Adapted from (UWFlow/uwflow_frontend) | What was adapted |
|---|---|---|
| `src/lib/timetable.ts` | `src/components/calendar/Calendar.tsx`, `src/components/calendar/calendarLayout.ts`, `src/pages/profilePage/ProfileCalendar.tsx` | The 64px hour height and time-to-pixel placement; lane packing for overlapping classes; the 9-to-5 hour range widened around early and late classes |
| `src/lib/calendar.ts` | `src/pages/profilePage/ProfileCalendar.tsx` | Expanding meetings into dated occurrences within their start and end dates; the opening week; the date-range title ("Sep 21st – 25th, 2026"); "Mon 21" column labels; showing a weekend day only when it has classes; hours of class per week |
| `src/lib/courseColors.ts` | `src/components/calendar/courseColors.ts` | One colour per course as a pale fill with a saturated rail, assigned in alphabetical order (the colour values are UW Go's, chosen for contrast) |
| `src/components/courses/Timetable.tsx` | `src/components/calendar/Calendar.tsx` | The hour grid with its half-hour line, the course block's layout and truncating text, and the Current Week / previous / next header |

UW Go's day and month views, the phone layout, the per-course colour picker and the height-based
choice of what a block shows are UW Go's own. No UW Flow data is redistributed, and UW Go makes no
request to UW Flow at runtime. UW Flow was also read for its canonical course-code normalisation (one
lower-case unspaced key, formatted for display at the edges), and the term-id scheme and
`M/T/W/Th/F/S/Su` day-code convention were reimplemented after studying its code.

MIT License

Copyright (c) 2025 UW Flow

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## University of Waterloo building data
`src/data/buildings/uw-buildings.generated.ts` is derived from the University of Waterloo campus map
Buildings feature service (the data behind https://uwaterloo.ca/map). No explicit licence is published;
UW Open Data is provided "as-is" under University Policy 46. Used for wayfinding estimates only.

## Wilfrid Laurier University building data
Building codes, names and addresses in `src/data/buildings/wlu.ts` are facts taken from wlu.ca and
students.wlu.ca pages. Coordinates marked `OSM` are © OpenStreetMap contributors, licensed under the
Open Database License (ODbL) 1.0, https://www.openstreetmap.org/copyright.

## rickytang666/quest2cal (MIT)
Its UW building-code → name table was used to cross-check names in our registry. No code copied.
