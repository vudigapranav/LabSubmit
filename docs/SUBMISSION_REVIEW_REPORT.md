# Lecturer submission review: the student's IDE in review mode

**Status:** fixed and verified locally and on the Docker stack. Not pushed, not deployed.
**Date:** 2026-11-10

When a lecturer opened a student's code, they got a stripped-down editor and an empty terminal.
They couldn't see what the student typed, what the program printed, or which code produced it. The
review now opens the student's own IDE in a read-only review mode:

- the immutable hand-in, in the same Monaco editor and file explorer;
- every recorded run underneath, with its input, output, errors, exit status and source;
- a separate, clearly labelled **Lecturer Test Run** that executes the stored hand-in.

---

## 1. Root cause

Input and output were **already being recorded**. Since iteration 6 the execution engine has
saved every student run as an `ExecutionRecord`: stdin, the terminal transcript, exit code,
duration and compile-failure flag. The data existed; the review screen didn't use it properly, and
one piece of data was missing.

| # | What was wrong | Where |
|---|---|---|
| 1 | The Code tab mounted `OnlineIDE` with only a **live** terminal. A live terminal starts empty by design, and the recorded runs were never put there. They were only on a separate Runs tab, as a list. | `src/app/lecturer/page.tsx` (inspector), `OnlineIDE.tsx` |
| 2 | `problemStatement=""` and no `questions` were passed, so the IDE's **Problem Statement** button opened an empty panel. | `src/app/lecturer/page.tsx` |
| 3 | On mount `OnlineIDE` always called `GET /api/student/workspace` to load the **live** workspace. With a lecturer's token it got a 403, so the hand-in stayed on screen, but only by accident. The review relied on a refusal to avoid showing live data. | `OnlineIDE.tsx` `fetchWorkspace` |
| 4 | **A run's source was not recorded.** An evaluator could see a run's output but not which version of the code produced it. A student can run one program and submit another. | `ExecutionRecord` had no source column |
| 5 | The inspector's **Run Code** ran whatever code the browser sent, through the faculty path of `authorizeRun()`. That path doesn't check the code against the submission. Its output also looked exactly like a student run. | `ExecutionController.ts` |
| 6 | The IDE wasn't keyed by submission, so its file state could carry over between students. Also, in light mode the "Integrity Timeline" heading was white on white. | `src/app/lecturer/page.tsx` |

## 2. What changed

### Components reused, not duplicated
- **`OnlineIDE`** got a `review` prop. It's the same component, Monaco configuration, file
  explorer, tabs, toolbar and problem-statement overlay the student uses. There's no new viewer.
  In review mode it:
  - never loads or saves the live workspace (`fetchWorkspace` and autosave are off);
  - shows a banner, "Review mode · Hand-in vN, submitted … · read-only";
  - shows the open file's language next to the editor tabs;
  - replaces the bottom terminal with a two-tab console: **Student runs (N)**, the default, and
    **Lecturer Test Run**;
  - renames Run Code to **Lecturer Test Run**, which asks the server to run the hand-in.
- **`Terminal`** is the student's xterm terminal, with two new optional props (`title`, `fill`)
  and a `submissionId` it forwards for review runs.
- **`RunHistory.tsx`** was split into `useRecordedRuns` (data), `RunDetail` (one run) and
  `runOutcome`. The existing **Runs** tab and the new **console under the editor**
  (`RecordedRunsConsole`) both use them, so the two can't drift apart.
- `compareRunSource` (pure, in `runTranscript.ts`) and `runSourceForRecord`
  (`executionRecords.ts`) contain the source rules.

### What the lecturer sees for each run
Run number, file, start time, language, result (`Exit 0`, `Runtime error · exit N`,
`Compile error`, `Time limit`, `Stopped`, `Killed`), duration. Also:
- the **stdin the student typed**;
- the **terminal output**, or the **compiler errors** for a failed compile;
- whether the run **used the same code as the hand-in** or different code.

When the source was recorded, **View this run's code in the editor** loads it into Monaco, under
an amber banner, "Showing the code student run #N compiled — this is not the hand-in". **Back to
the hand-in** restores the submitted copy. Lecturer Test Run is disabled while an older version is
shown, so it is never unclear which code a test run uses.

Console tabs: **Student runs** shows the student's recorded history and opens on the latest run.
**Lecturer Test Run** is the lecturer's own terminal, headed "Lecturer Test Run — runs the hand-in;
not part of the student's record". Each test run also prints "── Lecturer Test Run of main.py from
hand-in v1. Not part of the student's record. ──".

### Lecturer Test Run is now server-enforced
The inspector sends `submissionId` with the run. `authorizeRun()` checks:
- the lecturer owns the exam;
- the submission belongs to that same exam.

It then loads the **latest snapshot** on the server; for a pre-snapshot submission it loads the
workspace files, the same fallback the review API uses. **The code and files sent by the browser
are discarded.** If the requested file isn't in the hand-in, the run is refused
(`NOT_IN_SUBMISSION`). The run uses the normal sandbox (per-run uid, seccomp, ulimits) and its
`workspaceId` is null, so **no ExecutionRecord is written** and the snapshot is never touched.
Students are unaffected: a student who sends `submissionId` still goes through the student path,
which refuses with `ALREADY_SUBMITTED`.

## 3. Data persistence

| Data | Recorded before? | Now |
|---|---|---|
| stdin typed into the program | **Yes** (`ExecutionRecord.stdin`) | unchanged |
| Program output | **Yes** (`ExecutionRecord.stdout`) | unchanged |
| Compiler errors | **Yes** (`stdout` with `compileFailed = true`) | unchanged |
| Runtime errors (traceback, exit code) | **Yes** (in `stdout`; `exitCode`) | unchanged |
| Exit code, duration | **Yes** | unchanged |
| **Source the run compiled** | **No** | **New: `ExecutionRecord.files Json?`** |

**The one schema change:** `ALTER TABLE "ExecutionRecord" ADD COLUMN "files" JSONB;`. It's
nullable and additive, and no existing row is modified. `prisma migrate diff` showed this single
statement before it was applied. It was applied with `prisma db push`, without
`--accept-data-loss`, to the local dev database and to the Docker database. It was **not** applied
to production.

- The engine records the files the compiler actually writes: the auxiliary files, plus the entry
  file from `code`, which is what `CompilerService` compiles. They're stored in the snapshot's
  canonical order.
- Source is stored **whole or not at all**. Above 128 KB per run (`RECORD_SOURCE_LIMIT`) it's
  null, because clipped source isn't the code that ran.
- Runs recorded before this change have `files = null`. The UI says "Source for this run was not
  recorded" and never guesses whether it matched the hand-in.

**Not fabricated:** stdout and stderr are **not stored separately**. The program runs in a
pseudo-terminal, as the student's interactive terminal requires, so the two streams arrive already
interleaved, exactly as the student saw them. Separating them would mean giving up the interactive
terminal, so the UI labels the transcript "stdout and stderr together, exactly as the student saw
them". Compile errors are separate, because the compiler runs before the program starts.

## 4. Integrity

- The review shows the **latest `SubmissionSnapshot`**. It never shows the live workspace: the
  review IDE doesn't fetch it, and the submissions API reads snapshot files.
- The badge "Hand-in vN · integrity verified" is unchanged: the hash is recomputed and the HMAC
  checked server-side.
- Tests show that the review, a Lecturer Test Run and saving a grade leave the snapshot rows
  **byte-identical**, and the integrity check still reports `verified: true` afterwards.
- Tests also show that a Lecturer Test Run leaves the student's `ExecutionRecord` rows
  **byte-identical**, and adds no record anywhere.

## 5. Files changed

| File | Change |
|---|---|
| `prisma/schema.prisma` | `ExecutionRecord.files Json?` |
| `src/lib/executionRecords.ts` | `runSourceForRecord`, `RECORD_SOURCE_LIMIT`; persist `files` |
| `src/lib/runTranscript.ts` | `compareRunSource` (pure) |
| `src/lib/execution/ExecutionController.ts` | record each run's compiled source; `submissionId` review runs from the stored hand-in; `loadReviewSource` |
| `src/lib/execution/types.ts` | `submissionId?` on the run message |
| `src/app/api/lecturer/executions/route.ts` | return `files` |
| `src/components/OnlineIDE.tsx` | `review` mode |
| `src/components/Terminal.tsx` | `title`, `fill`, forwards `submissionId` |
| `src/components/RunHistory.tsx` | `useRecordedRuns`, `RunDetail`, `RecordedRunsConsole`; source match per run |
| `src/app/lecturer/page.tsx` | inspector passes the paper, questions and review context; IDE keyed by submission; light-mode contrast on the integrity timeline |
| `tests/helpers.mjs` | `runOnEngine` forwards `submissionId` |
| `tests/submission-review.test.mjs` | new, 14 tests |

## 6. Tests executed (actual results)

| Run | Result |
|---|---|
| `tests/submission-review.test.mjs` (new) | **14/14 pass** |
| Full suite, local server (:3100) | **180 tests: 177 pass, 0 fail, 3 skipped** (Linux-only isolation tests; they run on Docker) |
| Full suite, Docker (:3000), `LABSUBMIT_EXPECT_ISOLATION=1` | **180/180 pass** |
| Browser acceptance, review scenario: local | **32/32** |
| Browser acceptance, review scenario: Docker | **32/32** |
| Earlier three-role E2E workflow: Docker (regression) | **24/24** |
| `tsc --noEmit` | clean |
| `next lint` | 0 errors, 9 warnings (the same exhaustive-deps warnings as before) |
| `npm run build`, `docker compose build` | both succeed; the Docker log still shows per-run uid plus seccomp, `required=true` |

**New regression tests** (`tests/submission-review.test.mjs`), against the real engine:
- Python, multi-file (`main.py` imports `helper.py`), two runs with different stdin, then a
  runtime error from edited code:
  - each run is recorded with its stdin, output and **exact source**;
  - the edited run is recorded with the edited code.
- The review API returns the hand-in files with integrity verified. Each run's source compares
  `same` or `different` correctly.
- After the live workspace is changed (simulating "needs correction"), the review still returns
  the **hand-in**.
- **Lecturer Test Run:**
  - it runs the stored hand-in, while the browser sent `print("NOT THE HAND-IN")`, and neither
    that nor the edited workspace runs;
  - it's labelled;
  - student history, record count and snapshot rows are unchanged, and the snapshot still
    verifies;
  - it's refused for a file not in the hand-in, a submission from another exam, another
    lecturer, and a student.
- **C, C++, Java, JavaScript:** each run is recorded with stdin, output and source, and the
  Lecturer Test Run reruns the hand-in with new input without adding history.
- **Compile error:** recorded with diagnostics and source; the test run shows the same compiler
  error.
- Pure rules: source kept whole or not at all; exact comparison; never guesses for unrecorded
  source.

The source-recording and test-run tests fail against the previous code. That code recorded no
`files`, and its test run executed the browser's code without the label.

**Browser acceptance:** a real Chrome session through the real UI. The scratchpad script isn't
committed, the same as earlier browser checks.
1. The lecturer creates the exam through the endpoint the form uses.
2. The student logs in, starts the exam, fills the answer sheet, opens Code & Run, and picks
   **Python** in New Source File twice to create `helper.py` and `main.py`. They type the code,
   run it with `asha / 3`, run it again with `ravi / 12`, edit the code and run it with
   `bob / abc` (a runtime error), restore the code, and submit.
3. The lecturer opens Inspect, then Code, and checks:
   - the integrity badge says verified, and the review banner is shown;
   - all files are listed, and `main.py` holds the exact submitted source;
   - Python highlighting is on, and typing in the editor changes nothing (read-only);
   - switching files works;
   - the console opens on run #3: runtime error, its stdin, and the "different code" flag;
   - viewing run #3's code shows the edited version with the warning, and back-to-hand-in
     restores the original;
   - run #1 shows its own input and output and "same code as hand-in", and run #2 shows its own;
   - the problem statement shows the paper;
   - a Lecturer Test Run with new input prints a greeting and square from the hand-in, and the
     student's history is unchanged (still 3 runs);
   - the Answer Sheet and Runs tabs still work;
   - grading saves;
   - snapshot rows are byte-identical and integrity re-verifies;
   - there are no uncaught errors or 5xx responses.

## 7. Confirmations

- **The lecturer sees the exact submitted source.** It's the latest immutable snapshot, never the
  live workspace (tested, including after the workspace changes).
- **The original execution history is unchanged.** Lecturer Test Runs write nothing to it (tested
  byte-for-byte, local and Docker).
- **Integrity verification still passes** after review, test runs and grading (tested).

## 8. Limitations and what's needed from you

- **Runs from before this change have no recorded source.** They show stdin and output as before,
  marked "Source for this run was not recorded".
- **stdout and stderr are one interleaved transcript** (see §3).
- **A faculty token can still run arbitrary code through the engine without `submissionId`.**
  This existing engine-test path is what the 16 engine/security tests use. It writes nothing to
  any student's records, and the review UI never uses it.
- **Production deployment order matters.** Run `npx prisma db push` against production (adds
  `ExecutionRecord.files`) **before** deploying this code. If the code runs without the column,
  run recording fails: the failure is caught and logged, the student's program is unaffected, but
  those runs aren't recorded. The run-history API would also return 500.
- The browser test scripts left nothing behind: they create tagged fixtures and remove them.
  The earlier three-role E2E script, re-run as a regression check, still leaves its own test exam
  and student, as before.
