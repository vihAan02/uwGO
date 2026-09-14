# Field verification

What someone checked on campus, kept apart from what routing uses, and the deliberate step between
the two. A tap on the phone never changes a route.

| File | What it is |
|---|---|
| `types.ts` | An observation (one visit), the target as the page showed it, and a promotion. |
| `rules.ts` | What each mark means, which marks cannot go together, whether an export is well-formed, and whether a promotion claims only what its observations saw. The page, the script and the tests all use it. |
| `observations/` | Imported observations, one JSON file per verifier and day. Nothing routes on them; a test holds that no routing code imports them. |
| `promotions.ts` | Reviewed promotions: the only way anything seen on the ground reaches a route. |
| `priorities.generated.json` | The ranking of what to check, written by `npm run campus:field`. |

The targets and their ranking are computed in `src/engine/fieldTargets.ts` and
`src/engine/fieldPriority.ts`. `docs/campus-field-verification.md` is the list to walk, P0 first.

## On campus

Walk the list in `docs/campus-field-verification.md`, P0 first. Each target says where UW Go puts it
(a surveyed position, or only the building's map point when there is none), what UW Go believes and
on whose word, why it needs checking, and exactly what to check.

Record each visit as a `FieldObservation` (`types.ts`): the target as the doc names it (`targetRef`
in `src/engine/fieldTargets.ts` gives the exact shape), the time with the phone's own UTC offset,
the verifier, and the marks that were true: `ENTRY_WORKS`, `EXIT_WORKS`, `BOTH_WAYS`, `LOCKED`,
`AUTOMATIC_DOOR`, `STAIRS`, `RAMP`, `ELEVATOR`, `ACCESSIBLE`, `NOT_ACCESSIBLE`, `WRONG_LOCATION`,
`DOES_NOT_EXIST`. "Locked" means the way (or ways) not marked as working; on a change of floor it
means it needs a key or help. A note, a corrected location and a photo reference are optional.
Put the visits in a `FieldObservationFile` (schema `uwgo.field-observations/1`). A phone page that
writes these files is deferred; `rules.ts` is what it will have to satisfy, and `observationProblems`
says exactly what is wrong with a record.

## Into the repo

```bash
node scripts/campus-field.mjs import ~/Downloads/uwgo-field-observations.json
```

It checks every observation (a malformed export imports nothing) and adds the new ones under
`observations/`, one file per verifier and day. `list` shows what is there. Commit the files.

## Promoting

```bash
node scripts/campus-field.mjs review door:5ba0e3d2964bf706
```

`review` shows the target's observations, what they support, what they disagree about, how that
compares with what UW Go believes now, and a draft promotion. Observations that disagree are never
settled by majority: nothing they disagree on is drafted. Which way is "entry" is read from each
observation's own record of the target, so a label that changed between visits cannot flip a direction.

1. `UWGO_ROUTES_OUT=before.json npm run campus:regression` saves every route as it is.
2. Add the promotion to `promotions.ts`, with who reviewed it and a basis in plain words: what was
   seen, when, and in which direction. A door seen open at noon is not evidence it is open at 11 pm.
3. `npx vitest run src/data/campus` checks every claim against the observations it names.
4. `UWGO_ROUTES_BEFORE=before.json npm run campus:regression` lists every route that changed.
5. `npm run campus:field` and `node scripts/audit-campus-routing.mjs` regenerate the ranking and
   the audit.

What a promotion does to a fact, claim by claim:

- Finding it where UW Go shows it raises the fact's own evidence to at least FIELD_VERIFIED, and with
  it the crossing's cost. It does not vouch for anything else recorded about it: access claims and how a
  change of floor is made keep their own evidence, so a catalogue's "automatic door" on a door UW Go only
  guessed at stays unrelied on until someone marks the opener.
- A claim that confirms what stronger evidence already says keeps that evidence. A claim that adds or
  changes something rests on FIELD_VERIFIED. An old access claim routing could not rely on is set aside
  when the visit claims access, unless it is a restriction, which applies whatever its evidence.
- "Wrong location" (placement WRONG) quarantines the segment until someone finds it where UW Go shows it.
- How a change of floor is made only ever gains kinds: no visit can show an elevator is not there.
- A claim that would allow what stronger evidence restricts, contradict a recorded "not step-free", or
  replace official hours needs `supersedes`: why the ground wins. Lifting a quarantine must also say which
  ways the segment may now be used, or give `supersedes`.

## What a mark can support

| Claim | Needs |
|---|---|
| `placement: "CONFIRMED"`, or any other claim about a segment | a door, link or change of floor, and a visit that recorded finding it there (a mark other than "Wrong location" or "Doesn't exist") |
| `placement: "WRONG"` | "Wrong location" |
| a direction `ALLOWED` | a visit that found it working that way, and none that found it locked |
| a direction restricted | a visit that found it locked that way, and none that found it working |
| `automaticDoor: true` | "Automatic door". Nothing can promote `false`: an unmarked door is unknown, not manual |
| `ramp: true` | "Ramp" |
| `stepFree: true`, `independent: true` | "Accessible", no "Not accessible", no stairs without a ramp or elevator, and on a change of floor no "Locked" |
| `stepFree: false` | "Stairs" or "Not accessible" |
| `independent: false` | "Not accessible" or "Locked" |
| `vertical` | the matching "Stairs", "Ramp" or "Elevator" |
| `activation: "HISTORICAL"` | "Doesn't exist" on every observation named |
| `activation: "ACTIVE"` | on a door or link, a visit that used it and a restriction for every direction found locked; on a change of floor, a way between the floors seen and no "Locked"; and no observation saying it is not there |
| `hours` | the posted hours written in an observation's note |

A promotion cannot claim `accessibleDesignation` (the university's own listing), `EXPERIMENTAL` or
`QUARANTINED` activation (record a lock as a restricted passage, a wrong position as placement WRONG, or a
doubt in `overlay.ts`), an access flag of `null`, or an empty `access` or `vertical`.
