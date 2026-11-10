# EXAM_SECURITY_ARCHITECTURE.md

How an examination attempt is protected end to end, as implemented on 2026-11-08. Every rule
below is enforced on the server; client code only mirrors it for display. Status of everything the
brief asked for, including what is *not* built: `SCOPE_STATUS.md`.

## Attempt lifecycle and where each decision is made

| Stage | Server rule | Code |
|---|---|---|
| Open exam | published; student in the exam's cohort (year + branch) — same 404 otherwise | `examAccess.studentInExamCohort`, `api/student/workspace` GET |
| See the paper | only after the student's own Start (or once submitted); set identity never sent | `examAccess.examPaperReleased`, `questionSets.toStudentPaper` |
| Start | published, RUNNING, cohort re-checked, desktop device (fail closed); start time stamped once by the server | `start_exam` |
| Work | every action re-checks: own workspace, not submitted, before the effective deadline, device (fail open on continuation), file ownership, size limits | `api/student/workspace` POST |
| Run code | JWT per run, own workspace, RUNNING, deadline, language, device; ≤2 runs/user | `ExecutionController.authorizeRun` |
| Deadline | `min(lab.endTime, startedAt + duration)`; any request after it auto-submits what exists | `examTiming.getEffectiveDeadline`, lazy checks |
| Submit | atomic claim → one Submission + immutable hashed snapshot; idempotent receipt | `examSubmission.finalizeSubmission` |
| Evaluate | lecturer owns the lab; grades the latest snapshot; history audited | `api/lecturer/evaluate`, `submissions` |

## Server-authoritative time

- The deadline is computed only on the server from server timestamps (`startedAt` is set by
  `start_exam`, never taken from the client). Work after it is refused (403).
- The countdown runs on **server time**: responses carry `serverNow`; the client estimates its clock
  offset from each round trip and re-syncs on every heartbeat (`src/lib/serverClock.ts`).
  Reproduced before the fix: a clock 15 min fast auto-submitted with 10 real minutes left.
- Time zones/DST: all instants are UTC (`Date`/ISO); the countdown is a difference of instants, so
  neither affects it. Exam start/end entry in the lecturer UI uses the browser's local zone.
- Refresh, tab change, temporary disconnect, browser restart: the deadline is server state, so the
  timer resumes correctly after `GET workspace`; nothing restarts the clock.

## Submissions

Every hand-in writes a `SubmissionSnapshot` (files, answers, server time, version, on-time flag,
session id, SHA-256). Concurrent submits converge on one record (reproduced: 7 rows from 8 requests
before the fix). Repeated submits return the same receipt. "Needs correction" creates version 2 and
keeps version 1. Evaluators see the latest snapshot with each version's hash re-verified.

## Integrity signals (pre-existing, unchanged)

`ExamGuard` reports fullscreen exits, tab hide, blur and devtools shortcuts; severity is assigned
server-side; a fullscreen-exit threshold auto-submits; duplicate sessions are logged (not evicted);
the evaluator sees a timeline with a derived NORMAL / WARNING / FLAGGED status. These are signals,
not proof — see `EXAM_SESSION_SECURITY.md` for limits.

## Audit

Security-sensitive actions append to a hash-chained `AuditEvent` log — `AUDIT_LOGGING_DESIGN.md`.

## Known gaps

No lecturer-configurable concurrent-session policy (duplicates are logged, never blocked);
answer-sheet sections have no local draft backup (code files do); compiler isolation not deployed
and no network sandbox (`COMPILER_SECURITY_REVIEW.md`).

## Work preservation (iteration 14)

Code is autosaved ~1.5 s after typing stops (all edited files), mirrored to localStorage while
unsaved, retried with backoff when offline, and flushed on tab hide/close and before any
auto-submit. Saves carry the version they were based on; the server refuses (409) a save based on an
older version, so a delayed save can never overwrite newer work. After a crash a local draft is
restored only onto that exact server version. Worst-case loss: edits made in the last ~1.5 s before
the deadline (a save arriving after the deadline is refused by design).
