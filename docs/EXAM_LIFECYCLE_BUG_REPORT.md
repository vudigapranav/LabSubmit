# Exam lifecycle bug: exams completing at their start time

**Severity:** P0. Students could not enter the exam at all.
**Status:** Fixed and verified locally (unit tests, API tests, the full suite, and the Docker
stack in a real browser). Not pushed, not deployed.

## 1. Root cause

An exam's status was decided by its **end time alone**, and nothing checked that the end
time was after the start time.

```ts
// src/lib/examTiming.ts, before the fix
if (start && now < start) return 'UPCOMING';
if (end && now > end) return 'COMPLETED';
return 'RUNNING';
```

The lecturer form takes one **date** and two **times** (start and end), and combines each
time with the same date. If the end time is before the start on the clock face, the stored
`endTime` is *earlier* than `startTime`. This happens with an AM/PM slip (typing 2:42 meaning
PM, which the browser stores as 02:42), with the same time in both boxes, or with an exam
crossing midnight. The only server-side check was "end time is present".

So the exam showed UPCOMING until `startTime`, and at that instant `now > endTime` was
already true. It went straight to **COMPLETED**, skipping RUNNING entirely. The configured
duration played no part in the status, which is why the 5-minute and 180-minute exams
failed in exactly the same way.

**Confirmed in the data.** The "Test" exam in the Docker database was created at 06:13 UTC.
It stores `startTime 2026-11-09 06:14 UTC` (11:44 IST) and `endTime 2026-11-08 21:12 UTC`
(02:42 IST, the same calendar day), with no duration. That is 542 minutes *before* its start.

### Failure modes ruled out

| Hypothesis | Finding |
|---|---|
| Duration minutes vs seconds/ms | Duration is minutes everywhere (`* 60_000`); not the cause |
| Timezone conversion | The browser converts local→UTC once (`toISOString`), and the server compares absolute instants. The repro and tests show identical results in UTC, IST, New York and Auckland process time zones |
| Browser clock | Status is computed on the server only. The countdown already uses `serverClock.ts` |
| Dashboards vs access API disagreeing | All three use `getExamStatus()`, so they agreed, and were all wrong together |
| Status initialised as COMPLETED / background job / trigger | No stored status column, no cron. The DB triggers only protect snapshots and audit rows |
| Auto-submit at start | The deadline sweep only touches *started* workspaces past their deadline |

Secondary issue fixed at the same time: the boundary comparisons were inconsistent. Status
used `now > end`, the workspace route and engine used `now > deadline`, and the submission
receipt used `now <= deadline`. At exactly the deadline instant, these disagreed by a
millisecond.

## 2. The lifecycle model now

There is one rule, in `src/lib/examTiming.ts`, used by the dashboards, the workspace API,
the execution engine and submission:

```
windowEnd = endTime            if endTime is after startTime
          = startTime + duration   otherwise (end time missing or invalid)

UPCOMING   now <  startTime
RUNNING    startTime <= now < windowEnd
COMPLETED  now >= windowEnd

student deadline = min(windowEnd, startedAt + duration)
```

- `getExamWindowEnd()` is the single place the window end is derived.
- `getExamStatus()` and `getEffectiveDeadline()` both use it.
- `isPastDeadline()` is the single "at or past the deadline" comparison.
- `validateExamSchedule()` is the single schedule rule, shared by the lecturer form and the
  labs API. It refuses:
  - an end time at or before the start (with an AM/PM hint);
  - a window shorter than the duration;
  - a missing start time;
  - an exam with neither an end time nor a duration;
  - a duration that is not a whole number from 1 to 1440 minutes.
- An **end time is now optional** when a duration is given. The window is then start + duration.

## 3. Files changed

| File | Change |
|---|---|
| `src/lib/examTiming.ts` | `getExamWindowEnd`, `isPastDeadline`, `validateExamSchedule`, `scheduleProblem`; status and deadline both use the window end |
| `src/app/api/lecturer/labs/route.ts` | POST and PUT validate the (merged) schedule and return 400 with the reason; the list includes `scheduleProblem` |
| `src/app/lecturer/page.tsx` | The form validates with the same rule, shows a live "open from … to …" summary or the problem, and labels the end time optional; exam cards show a warning for a broken stored schedule |
| `src/app/api/student/workspace/route.ts`, `src/lib/execution/ExecutionController.ts`, `src/lib/examSubmission.ts` | Deadline comparisons use `isPastDeadline` |
| `tests/exam-lifecycle.test.mjs` | 8 frozen-clock unit tests |
| `tests/exam-lifecycle-api.test.mjs` | 5 end-to-end API tests |

## 4. Database implications

**No schema change, no migration, and no data rewrite.** Existing rows are interpreted, not
modified:

- **Stored end before start, with a duration:** the exam now runs for its duration from the
  start, and the lecturer card shows *"the exam uses its N-minute duration instead. Edit the
  schedule."*
- **Stored end before start, without a duration** (the Docker "Test" exam): there is nothing
  safe to infer, so it stays closed (not silently reopened) and the card shows *"closes as
  soon as it starts. Edit the schedule."*
- **Valid schedules:** behave exactly as before.
- A PUT that does not touch the schedule (rename, publish) still works on a broken exam, so
  the lecturer can always reach it to fix it. Re-saving a broken schedule is refused.

## 5. Tests

**Frozen clock** (`exam-lifecycle.test.mjs`), with no sleeping:
- 1 minute and 1 ms before start; exactly at start; +1 s; +1 min; midway; 1 s before the
  deadline; exactly at the deadline; 1 s after it.
- A 180-minute exam is RUNNING at minutes 0, 1, 30, 90, 179 and at 179:59, and COMPLETED at 180:00.
- The two reported data shapes now run. Proven against the old code: it returns COMPLETED
  for both, 30 s and 2 min after start.
- The per-student deadline, including late starters.
- The same instant written in IST or UTC gives the same status.
- The server process time zone (UTC, Asia/Kolkata, America/New_York, Pacific/Auckland) does
  not change the status or the window end.
- Schedule validation accepts and refuses the cases in section 2.

**Real API** (`exam-lifecycle-api.test.mjs`):
- Broken schedules are refused on save.
- UPCOMING on both dashboards, and `start_exam` refused before the start.
- RUNNING at the start, and the student starts with a deadline about 5 minutes out.
- A refresh keeps the same `startedAt` and deadline.
- The student can autosave, run code with stdin, fill the answer sheet, and submit with an
  on-time receipt.
- A 180-minute exam is RUNNING with a deadline of about 180 minutes.
- At expiry: COMPLETED on both dashboards, saves refused (403), runs refused by the engine.
- A legacy broken row is repaired by its duration, flagged, and still editable.

## 6. Before and after (Docker stack, real APIs)

| Exam | Before | After |
|---|---|---|
| A: start +1 min, 5 min, end = start | Saved. UPCOMING, then **COMPLETED at start**; entry 403 | **Refused on save** (400, "end time must be after the start time…") |
| B: start +1 min, 180 min, AM/PM slip | Saved. UPCOMING, then **COMPLETED at start**; entry 403 | **Refused on save** (400) |
| C: started, 15 min, correct end | RUNNING | RUNNING (unchanged) |
| D: start +1 min, 5 min, correct end | n/a | UPCOMING, then RUNNING at start, +30 s and +2 min; IDE run and autosave OK; still RUNNING 2 s before 06:35:00; COMPLETED 1 s after; auto-submitted (TIMEOUT, on time); saves and runs refused |
| E: start +1 min, 180 min | n/a | RUNNING at start, +30 s and +2 min |

Both dashboards matched the access API at every sample.

Browser check on Docker (headless Chrome), on a 5-minute exam created through the lecturer API:
- no Start button before the start; offered at the start;
- the answer sheet renders and Monaco loads;
- the timer starts at 00:04:57 and a program runs in the terminal;
- a refresh shows the fullscreen gate, then resumes with the clock continuing (04:57 → 04:52).

## 7. Remaining limitations

- **Exams that cross midnight** cannot be entered: the form has one date shared by both
  times. They are refused with an explicit message rather than silently breaking. Supporting
  them needs a separate end date, which is a product decision.
- **Existing broken exams without a duration** stay closed until the lecturer edits them.
  This is deliberate.
- The form's local times are converted to UTC using the lecturer's browser time zone. A lecturer whose computer clock zone is wrong will
  schedule in that zone. The live summary shows the resulting window before saving.
- Lint remains unconfigured (no ESLint config in the repository).
