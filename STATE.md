# STATE.md — LabSubmit implementation status

A factual snapshot of what exists in this repository. Companion to `CLAUDE.md`
(product direction and engineering rules).

**Last updated:** 2026-09-03, after result release / publication control on
`claude/labsubmit-development-y605fv`.

**Rule for maintaining this file:** nothing is listed as Completed unless the code for it
exists in the repository. A database model with no code reading or writing it is *schema
only* and belongs under In Progress, not Completed.

---

## 1. Completed

### Platform & infrastructure
- Next.js 14 App Router + TypeScript; custom `server.js` running HTTP and a WebSocket
  upgrade on `/api/ws`.
- Prisma + PostgreSQL. Schema managed via `prisma db push` — there is **no**
  `prisma/migrations/` directory.
- Split deployment documented and wired: Vercel (UI + REST), Railway (execution engine +
  Postgres). `NEXT_PUBLIC_WS_URL` points the terminal at the execution host, with a
  same-origin fallback for local development. `node-pty` is an optional dependency so the
  Vercel build does not attempt to compile a native addon it never uses.
- Seed script covering admin, lecturers, branches, subjects, students and sample exams.

### Authentication & roles
- JWT signing/verification, accepted from an `Authorization: Bearer` header or a cookie.
- Three roles — ADMIN, LECTURER, STUDENT — enforced by a shared `requireAuth(req, roles)`
  route guard.
- Student self-registration gated on an admin-authorised roll-number range.
- Client session and theme state in `AppContext`; theme persisted per user.

### Administration
- Branch, subject, lecturer and student management; roll-number range allocation;
  lecturer password reset; system statistics.

### Examination configuration (lecturer)
- Create / edit / publish examinations, scoped to the lecturer's assigned subjects; drafts
  stay hidden from students. **Permanent deletion is restricted** — see
  "Exam deletion protection & archive" below.
- Scheduling: exam date, start time, end time, per-student duration.
- Allowed programming languages per exam (C, C++, Java, Python).
- Secure exam mode toggle, fullscreen-exit threshold, and copy / paste / cut / right-click
  / drag-drop permissions.

### Examination runtime (student)
- Server-computed exam status: DRAFT / UPCOMING / RUNNING / COMPLETED.
- Effective deadline is the earlier of the exam end time and the student's own
  `startedAt + duration`.
- Explicit "Start Exam" step that begins the personal countdown, distinct from opening the
  page.
- Multi-file Monaco workspace with create / rename / delete, language restricted to the
  exam's allowed set; file extension derived from an explicit language choice.
- Lazy, server-authoritative deadline enforcement re-checked on **every** mutating action,
  so state self-heals regardless of whether any client timer ever fired.
- Single-submission locking; workspace becomes read-only after submit.

### Live code execution
- WebSocket-driven interactive PTY execution: `ExecutionController` → `CompilerService`
  (gcc / g++ / javac / python) → `PtyService` → `RuntimeSandbox` → `CleanupService`.
- Real stdin: programs that prompt for input work interactively in an xterm terminal.
- Limits enforced: 60s runtime, 5 MB output cap, temp-directory cleanup, process kill on
  disconnect.
- Execution is authorised on every run: token → workspace ownership → exam status →
  deadline → allowed language → device eligibility, before any process is spawned.

### Examination integrity
- Violation logging with **server-assigned** severity (a client cannot downgrade its own
  violation), a 2-second dedupe window, and a fullscreen-exit counter.
- Auto-submit on fullscreen-exit threshold and on deadline expiry, both converging on one
  idempotent `finalizeSubmission()` helper shared by every submit path.
- Duplicate-session detection via heartbeat: a second tab is logged, not evicted, so an
  ordinary refresh never misfires.
- Fullscreen enforcement, tab-switch / blur detection and devtools-shortcut interception
  in `ExamGuard`.
- Faculty-facing integrity timeline with a derived NORMAL / WARNING / FLAGGED status.

### Evaluation & results
- Submission inspector: student's files rendered read-only, with the integrity timeline.
- Manual evaluation: marks, remarks, status (APPROVED / REJECTED / NEEDS_CORRECTION /
  PENDING). Saving an evaluation never publishes it — visibility is controlled by an
  explicit exam-level release (see "Result release / publication control" below).
- `NEEDS_CORRECTION` reopens the student's workspace for resubmission.
- Student results view showing only released marks and remarks.

### Unified customizable answer sheet — *added this session*
- Nine-section catalogue (Aim, Description, Algorithm, Procedure, Code, Input, Output,
  Conclusion, Iteration) as **one configurable sheet**, not multiple exam formats.
- Lecturer configurator: enable/disable, reorder, rename headings, set required status and
  per-section marks, inside the existing exam modal.
- Student answer sheet with per-field debounced autosave, presented beside the code
  workspace; both panes stay mounted so switching never tears down the editor, terminal or
  execution socket.
- The Code section is bound to the workspace's source files rather than a textarea, so the
  written record cannot disagree with what actually ran.
- Section kind (`contentSource`) is always resolved from the server-side catalogue, never
  from the request; unknown section keys submitted by a client are dropped.
- Required-section validation blocks a **manual** submit only; timeout and
  integrity-threshold auto-submits still capture whatever exists.
- Reconfiguring a format updates sections in place, so disabling a section preserves
  answers already written into it. Only a section removed from the format entirely is
  deleted.
- Evaluator view renders the completed sheet alongside the code.
- An exam with no sections configured behaves exactly as before — code-only, no tab strip.
- **Preview.** The configurator previews the sheet before the exam is published, rendering
  the *real* student component with persistence switched off, driven by the unsaved working
  draft. The preview cannot drift from what students receive because it is the same
  component, not a lookalike.
- **Reconfiguration warning.** Editing the format of an exam students have already begun
  shows how many attempts are affected and what changing a required section will mean for
  them. Warned, not blocked — the lecturer decides.
- **Input/Output connected to the execution engine.** The existing terminal now captures
  each run (stdin the student typed, stdout the program produced), and the Input and Output
  sections offer a "Use last run" control that fills them from the real execution instead of
  retyping. Platform banners ("Compilation Successful", "Program Finished") are marked
  `system` server-side and excluded from the capture, and ANSI escapes are stripped, so a
  lab record contains the program's output and nothing else. This reuses the existing
  execution path — no second editor, no second execution route.

### Multi-set randomized examination — *completed this session*
- A lecturer authors **multiple sets per examination**, each holding a **lecturer-defined
  number of questions** (`Question` rows under `QuestionSet`, not one blob per set), with
  optional per-question marks and reordering.
- Question Sets manager opened from the exam row: create/rename/delete sets, toggle a set
  active, add/edit/reorder/delete questions, with live counts of how many students hold
  each set.
- **Random assignment** on `start_exam`, drawn from the least-used eligible sets so a cohort
  spreads evenly while the individual draw stays random. The assignment is pinned to the
  workspace and never re-drawn.
- A set is eligible only if it is active **and has at least one question**, so a student can
  never be handed a blank paper.
- **Student set identity is hidden.** `toStudentPaper()` builds the student payload from
  what a student may know (question order, text, marks) rather than by deleting fields from
  the internal object. Set id, set label, how many sets exist and sibling-set content are all
  absent — verified by scanning entire raw student responses for each. The workspace's own
  `questionSetId` foreign key is stripped too: it is not a label, but it is a stable
  identifier two students could compare to discover they hold the same paper.
- **Faculty see the full mapping**: a student→set table (roll number, name, set, start time,
  status) plus per-set assignment counts, and the submission inspector shows which set a
  student sat and the exact questions they were given.
- Deleting a set students are already sitting is **refused** (it would blank their paper
  mid-exam); the lecturer is told to deactivate it instead, which stops future assignment
  while leaving existing attempts intact.
- Exams with no sets are unaffected: they continue to serve `Lab.problemStatement`.
- **Per-set preview** renders the paper through the same `QuestionPaper` component the
  student's exam uses, so a preview cannot drift from what students read.
- **Explicit assignment generation.** `POST /api/lecturer/assignments {action:'generate'}`
  assigns every eligible student (same year and branch the exam targets) who does not
  already hold a set, creating their workspace with the same starter file a student would
  get by opening the exam — and deliberately WITHOUT `startedAt`, so pre-assigning never
  starts anyone's clock. It is idempotent: an existing assignment is never re-drawn, and the
  balance tally is seeded from assignments that already exist so a second run keeps the whole
  cohort even rather than balancing only the newcomers.
- **Assignment is immutable except by explicit administrative action.** Two guards, both
  audited:
  - Replacing the questions of a set students are *currently sitting* is refused (HTTP 409)
    unless the lecturer passes `acknowledgeLiveEdit`. Renaming or deactivating a live set
    stays freely allowed — neither changes anyone's questions, and deactivating is the safe
    way to retire a bad set.
  - Reassigning one student's set is a deliberate lecturer action, warns when the attempt is
    already in progress, and is **refused outright once the student has submitted** — their
    answers were written against the paper they sat.
- **`ExamAdminAction` audit trail** records generation, reassignment and live-set edits with
  actor and timestamp, surfaced in the manager's mapping tab.
- Students cannot influence assignment: a client-supplied `questionSetId` on `start_exam` is
  ignored (the server resolves the set from persisted state), and both faculty routes reject
  student tokens with 403.

### Responsive platform — *completed this session*
- Navigation: the full institution name is abbreviated below `sm` (it previously overflowed
  a phone header), with a smaller logo and tightened spacing.
- Student dashboard: wrapping metadata chips instead of one bullet-separated line, shortened
  tab labels on narrow screens, and reduced page/card padding.
- **Results render as stacked cards below `md`** rather than a five-column table — this is
  the screen students check most often on a phone, and horizontal scrolling for it was the
  clearest instance of merely shrinking the desktop UI.
- Login and registration: mobile padding and spacing; the registration form's paired fields
  stack below `sm`.
- Lecturer and admin: page and header padding, and rigid modal grids (`grid-cols-3` date
  fields, `grid-cols-4` language pickers, `grid-cols-2` pairs) now stack below `sm`.
- Dialogs: reduced outer and inner padding on small screens, with the profile modal made
  scrollable so it can never exceed the viewport.
- Faculty data tables keep horizontal scrolling — appropriate for dense multi-column data —
  but now carry a minimum width so columns are not crushed into illegibility while scrolled.
- Verified at a 390×844 iPhone viewport: no horizontal page scroll on login, dashboard,
  results or the exam gate.

### Device policy — *added this session*
- Server-side device classification from request headers (`User-Agent`,
  `Sec-CH-UA-Mobile`, `Sec-CH-UA-Platform`) in `src/lib/deviceEligibility.ts`.
- Enforced at all three entry points into an attempt: `start_exam`, every mutating
  workspace action, and `authorizeRun()` on the execution WebSocket — so a phone cannot
  reach the execution engine directly to bypass the REST gate.
- A client hint may only make the check **stricter** (covers iPadOS, which deliberately
  reports a desktop User-Agent); a device claiming to be a desktop is never believed.
- Fails closed on starting an unidentifiable device, fails open on continuing one, so no
  student is locked out mid-paper by an odd header.
- Per-exam `requireDesktopDevice` toggle; device class recorded on the attempt for audit.
- Dashboards, results and non-exam pages remain reachable from any device.
- **Exam content is withheld from an ineligible device, not merely hidden.** The workspace
  response returns no questions, no problem statement, no answer-sheet sections and no
  source files when the device may not sit the exam, and sets `examContentWithheld`. A phone
  therefore cannot read the paper out of the API and work on it elsewhere. A *submitted*
  attempt is exempt, because reviewing what you submitted is submission history, which the
  platform keeps available on any device.
- The student-facing wording is defined once, as `UNSUPPORTED_DEVICE_MESSAGE` in
  `deviceEligibility.ts`, and rendered verbatim by the UI so the two cannot drift.

### Verification performed
- `tsc --noEmit` clean; `next build` compiles successfully (35/35 pages).
- Unit assertions over device classification (real UA strings for Windows, macOS, Linux,
  Android phone/tablet, iPhone, iPad, absent UA) and over answer-sheet normalisation and
  required-section validation.
- End-to-end API run against a live PostgreSQL instance — 20 assertions covering:
  configuration persistence (labels, marks, required and disabled flags round-trip);
  student rendering following the lecturer's order rather than the catalogue's; disabled
  sections absent from the student payload even when marked required; required-section
  validation naming the lecturer's *custom* labels, releasing each as it is filled, and
  never demanding optional or disabled sections; reordering reaching the student while
  existing answers survive; and a legacy exam with no configuration loading, running and
  submitting with no sheet validation at all.
- Browser verification (headless Chromium) — 11 assertions covering the configurator
  rendering all nine sections with reorder and marks controls, and the preview opening,
  declaring itself unsaved, honouring a renamed label, omitting a disabled section,
  reflecting a reorder, and rendering Code as an editor pointer rather than a textarea.
- **Execution regression:** real C source compiled and run through the live WebSocket
  engine with interactive stdin (`7` → `square=49`), verifying exit code 0, that captured
  output excludes platform banners, and that it contains no ANSI escapes. Captured Output
  content was exactly `"Enter n: 7\nsquare=49\n"`. Re-run after the question-set work on an
  exam that uses sets, together with the answer-sheet save/validate path.
- **Multi-set examination:** 39 end-to-end assertions covering 8 sets of differing size over
  25 students — generation assigning all 25 with a 3/3/3/3/3/3/3/4 spread, a second run
  assigning nobody new and every student keeping their set, a pre-assigned paper surviving
  start and reconnect unchanged, pre-assignment not starting anyone's clock, a
  client-supplied `questionSetId` being ignored, student tokens rejected by both faculty
  routes, a live set edit refused then permitted on acknowledgement and audited, renaming a
  live set needing no acknowledgement, reassignment warning on a live attempt and refused
  after submission, and the full evaluator chain (student → set → questions → submission →
  evaluation). 10 browser assertions over preview, generation, reassign controls and the
  audit panel.
- **Question sets:** 19 unit assertions (normalisation, assignability, identity stripping,
  and a simulated 60-student cohort spreading exactly 20/20/20 while drawing randomly) and
  18 end-to-end assertions against a live database with 12 real students — two sets of
  differing size authored, a 6/6 random-but-even split observed, every student's full raw
  payload scanned for set ids, labels, sibling-set content and counts (none present),
  assignment pinned across repeated fetches, inactive and empty sets never assigned, the
  faculty mapping visible, deletion of an in-use set refused, and an exam with no sets still
  serving its own statement. 11 browser assertions over the authoring UI and mapping table.
- **A real leak was found and fixed by this testing:** the student's workspace object still
  carried `questionSetId`. It is now stripped alongside the joined set.

### Exam deletion protection & archive — *completed this session*

Closes the P0 finding from the lecturer UX audit: `DELETE /api/lecturer/labs` previously had
**no guard of any kind**, and `Lab` carries six `onDelete: Cascade` relations, so one click on
an unlabelled trash icon behind a generic `confirm()` destroyed every workspace, submission,
awarded mark, integrity event, question set and answer-sheet section under that exam.

**Permanent deletion policy.** An examination is permanently deletable **only** when no
student has touched it. "Touched" is deliberately broad — any one of these refuses the
delete: a started attempt (`LabWorkspace.startedAt` not null), any `Submission`, any
`ExamViolation`, any `LabFile`, or any `AnswerSheetResponse`. A bare workspace row does *not*
count, because one is created merely by opening the exam page. Counts are re-derived from the
database on every DELETE request, never read from the client, so calling the endpoint
directly — with or without a forged override body — cannot get past it. A refused delete
returns **HTTP 409** carrying `code: "EXAM_HAS_STUDENT_ACTIVITY"`, `canArchive: true`, the
activity counts, and the preservation/effect lists the dialog renders. The payload contains
**counts only** — no student names, roll numbers or ids.

**Archive behaviour.** Archiving writes exactly one column, `Lab.archivedAt`, and touches no
other row — which is why the preservation claims are safe to make. `getExamStatus()` returns
`ARCHIVED` for such a lab, ahead of every schedule-derived state. Because the student
workspace route and `ExecutionController.authorizeRun()` both already refuse anything that is
not `RUNNING`, retiring an exam closes **all three attempt entry points at once** without a
new check in any of them. `/api/student/labs` additionally filters `archivedAt: null`, so an
archived exam never appears as active or upcoming work. Published results are unaffected:
`/api/student/grades` keys off the submission, not the lab, so a student keeps the marks and
remarks for an exam that has since been archived. Faculty keep full access — archived exams
stay in the lecturer list (badged `ARCHIVED`), their submissions stay gradeable and their
question sets stay readable. Archiving is reversible via the same endpoint.

**Server-side protection.** The rule lives in `PATCH`/`DELETE` on
`src/app/api/lecturer/labs/route.ts` behind the same `assertLabAccess()` ownership check the
question-set routes use: a LECTURER may act only on their own exams, an ADMIN on any;
students and unauthenticated callers are rejected. `src/lib/examLifecycle.ts` is a pure module
(no Prisma import) holding the activity rule, the refusal wording and the
`ARCHIVE_PRESERVES` / `ARCHIVE_EFFECTS` lists, so the API and the confirmation dialog cannot
drift — the UI can never promise something the implementation does not do.

**Audit logging.** Uses the existing `ExamAdminAction` model, with two safe widening changes:
`labId` became nullable with `onDelete: SetNull` (under the previous `Cascade` the one row
that mattered most — "this exam was permanently deleted" — was destroyed by the very delete
it documented), and a `labTitle` snapshot was added so an orphaned row still names what went.
Actions written: `DELETE_EXAM`, `ARCHIVE_EXAM`, `UNARCHIVE_EXAM`, each with the acting user
and a details string. A no-op archive/unarchive is idempotent and writes no row.

**Frontend.** The native `confirm()` is gone. `src/components/ExamRetirementDialog.tsx` shows
one of three faces, chosen from what the server reported: *delete* (names the exam, states it
cannot be undone), *archive* (leads with "Exam cannot be deleted because student attempts
exist", then lists precisely what is preserved and what changes), or *restore*. Backdrop
dismissal is disabled. Exam-card actions are now labelled (`aria-label` + `title`) in 36 px
targets, with delete/archive separated from edit by a divider and a destructive hover state;
the icon shown is the action the server will actually permit.

**Tests performed** — `scratchpad/archive.test.sh`, **52 assertions, all passing** against the
running server and the real database, plus 21 browser assertions (`ui-archive.js`) and a
WebSocket test (`ws-archive.js`). Covers: zero-attempt draft deletes and is audited; the audit
row survives the cascade; exam with one and with several attempts refuses deletion; direct API
DELETE with a forged override body still refused; no student identity in the refusal; archived
exam remains listed, gradeable and set-readable for its lecturer; archived exam disappears
from the student lab list; `start_exam` on an archived exam refused with `status: ARCHIVED`;
the execution WebSocket compiled and ran code before archiving and returned
`EXAM_NOT_ACTIVE (status: ARCHIVED)` after; submissions, workspaces, files, marks + status,
question sets, questions, student-to-set assignment, answer-sheet sections and answer-sheet
responses all byte-identical across an archive; foreign lecturer, student and unauthenticated
callers refused 403 on both delete and archive; existing assigned-question-set deletion
protection still returns its original 409. Typecheck and `npm run build` both clean.

**Limitations.**
- Archive is a lecturer/admin action; there is no bulk archive and no automatic archiving of
  long-finished exams.
- Deleting a zero-attempt exam still deletes its question sets and answer-sheet configuration.
  That is intended — no student work exists — but it is not recoverable.
- The audit trail is written but has **no UI**: `ExamAdminAction` rows are only readable from
  the database or through `/api/lecturer/assignments`, which surfaces assignment actions only.
- `archivedAt` records *when* an exam was archived; the actor is recorded on the
  `ExamAdminAction` row rather than denormalised onto `Lab`.

### Result release / publication control — *completed this session*

Closes the second P0 finding. **What the audit got right and wrong:** `evalPublish` was indeed
a client `useState(true)` that was never changed and was sent as `isPublished` on every grade
save, so saving a mark published it instantly. But `Submission.isPublished` already defaulted
to `false` in the schema, and `/api/student/grades` already filtered on it — a partial
workflow existed and has been completed rather than duplicated.

**Three leaks the audit did not find,** all now closed:
- `GET /api/student/workspace` returned the raw Prisma `Submission` row — marks, remarks,
  status, `evaluatorId` — to the student with no publication check at all.
- `POST /api/student/workspace` (`submit_lab`) returned the same row; after a
  `NEEDS_CORRECTION` reopen it still carried the previous marks and remarks.
- `GET /api/student/labs` returned `submission.status` unguarded, so `APPROVED`/`REJECTED`
  revealed the evaluation outcome before release.

**Publication model.** `Submission.isPublished` stays the authoritative per-record gate that
student APIs filter on. `Lab.resultsReleasedAt` (new, nullable, additive) is the exam-level
switch the lecturer operates. These are not competing models: the timestamp is the switch,
`isPublished` is how it is materialised onto rows, and release sets both in one
`prisma.$transaction` so they cannot disagree. Scope is per-exam/cohort, which is what the
existing schema supports cleanly — `Submission` already had the per-row flag, so no grading
model redesign was needed.

**Default unpublished.** `resultsReleasedAt` is nullable with no default, so every existing
and new exam reads "not released". `prisma/backfill/2026-09-result-release.sql` is an
UPDATE-only, re-runnable script for environments that predate this change and carry rows
published by the old behaviour; it marks those exams as already-released so the switch and
the rows agree. It was a no-op on this database (no such rows existed).

**Server-side enforcement.** `POST /api/lecturer/evaluate` no longer reads `isPublished` from
the request body at all — publication is derived from `lab.resultsReleasedAt`. Sending
`isPublished: true` is ignored (tested). `/api/student/grades` requires **both** gates
(`isPublished: true` AND `lab.resultsReleasedAt` not null), so a stale flag from a legacy row
or a direct database edit still cannot surface. The workspace route builds the student's view
of their own submission with `toStudentSubmission()` — constructed from what a student may
know rather than by deleting fields, so a column added to `Submission` later cannot silently
start leaking. Before release a student sees that they submitted and when, and nothing else;
`status` reads `SUBMITTED`. Checked and clean: the execution WebSocket carries no submission
data, and `SectionEvaluation` has no code references anywhere, so there is no section-marks
path to leak through.

**Lecturer release.** `PATCH /api/lecturer/labs` with `{ id, releaseResults: true }` — the
same lifecycle endpoint archive uses, behind the same `assertLabAccess()` ownership check.
Exam cards show a `Results released` / `Results not released` badge with graded/pending
counts and a labelled **Release results** button; `ResultReleaseDialog` (built on the shared
`Modal`, `dismissOnBackdrop={false}`) shows the counts, states that students will see their
marks and that release cannot be undone, and lists the effects from `RELEASE_EFFECTS`.

**Incomplete grading.** Release is refused with **409** and
`code: "RELEASE_BLOCKED_INCOMPLETE_GRADING"` unless every submitted attempt is evaluated,
enforced server-side and re-derived per request. Chosen over partial release so a lecturer
can never believe the cohort has results when only some do. The dialog shows the blocking
reason and does not offer the action.

**After release.** Grades saved afterwards publish immediately, because withholding one
student's mark once their classmates have theirs is the confusing case. Editing a released
mark updates only that row. There is deliberately **no un-release action** — it is not needed
for the workflow and would let a student see a mark and then lose it.

**Audit logging.** `RELEASE_RESULTS` on the existing `ExamAdminAction`, with actor, exam,
title snapshot and the number of results made visible. A repeat release is idempotent and
writes no second row.

**Tests** — `scratchpad/release.test.sh`, **52 assertions, all passing**, plus 18 browser
assertions (`ui-release.js`). Covers cases A–K: default unpublished; saving a grade does not
publish; a forged `isPublished: true` is ignored; the student cannot obtain marks, remarks or
the evaluation outcome from the grades, labs or workspace APIs before release; release
blocked at 409 with incomplete grading; foreign lecturer, student and unauthenticated callers
refused; release succeeds, publishes and audits; the student then sees marks and remarks
through every route; idempotent re-release writes no duplicate audit row; state survives a
fresh login; post-release grading publishes immediately. Regression: the 1bbd83b archive and
delete-protection suites (52 API + 20 browser + 3 WebSocket) all still pass.

**Limitations.**
- No un-release. Deliberate, as above.
- Release is per exam; there is no cross-subject bulk release.
- `Submission.isPublished` is still writable by a direct database edit, but the double gate
  on the grades API means such a row cannot surface while its exam is unreleased.
- The `RELEASE_RESULTS` audit rows, like the others, have no UI.
- Out of scope and still open: `GET /api/lecturer/labs` accepts the STUDENT role. It returns
  only cohort-level aggregate counts, no per-student marks, so it is not a publication leak —
  but it remains the separate audit finding it was.

## 2. In progress

These have **database schema and, where noted, partial runtime support**, but are not
usable end to end.

### Input/output capture — client-side capture done, persistence not
- Runs **are** captured client-side and can be inserted into the Input/Output sections of
  the answer sheet (see Completed). Once inserted, the text persists as an ordinary answer.
- `ExecutionRecord` model exists but **zero code reads or writes it**. Nothing about a run
  is stored as a run: there is no server-side execution history, no record of runs the
  student chose not to insert, and no way for an evaluator to see what else was executed.
- Because insertion is student-initiated, Input/Output remain *attested* rather than
  *proven*. A student can still type something a program never produced. Closing that gap
  needs the `ExecutionRecord` write path.

### Section-wise evaluation
- `SectionEvaluation` model exists. **Zero code reads or writes it.**
- Per-section `maxMarks` is configurable and displayed, but evaluation still records a
  single flat total on `Submission`. No breakdown is captured.

## 3. Newly planned (agreed requirements)

Recorded so intent is not lost. Items marked ✅ are delivered; the rest are outstanding.

| # | Requirement | Status |
|---|---|---|
| 1 | Unified customizable answer-sheet examination model | ✅ Complete, including preview |
| 2 | Multiple randomized question sets | ✅ Complete — any number of sets, any number of questions each, preview, explicit generation |
| 3 | Hidden student set identity | ✅ Complete (payload built from what a student may know; ids, labels and counts all absent) |
| 4 | Lecturer-visible assignment mapping | ✅ Complete (student→set table plus per-set counts and the inspector badge) |
| 5 | Mobile-compatible general application | ✅ Audited and fixed at phone width (exam page remains desktop-only by policy) |
| 6 | Desktop/laptop-only active exams | ✅ Complete, enforced server-side at all entry points |
| 7 | Digital record containing configurable sections | ✅ Complete |
| 8 | Code execution with input/output capture | ⏳ Execution complete; capture wired into the answer sheet; server-side persistence outstanding |
| 9 | Lecturer manual evaluation workflow | ⏳ Works at submission level; section-wise marking not started |

---

## 3b. UI/UX Refinement

### Design-system status
Established and in use. `src/components/ui/index.tsx` is the single source of visual truth;
`tailwind.config.js` carries the tokens (`rounded-card`, `rounded-control`, `shadow-card`,
`shadow-cardHover`, `shadow-overlay`, `w-sidebar`, animation keyframes) as an **extension**
of the existing LabSubmit palette — olive and blue are unchanged, no new hues introduced.
`globals.css` adds a global `:focus-visible` ring, a `prefers-reduced-motion` guard and a
tabular-numerals helper.

### Shared components created
`Button` (5 variants × 3 sizes, loading state), `Card`, `SectionCard`, `PageHeader`,
`StatCard`, `StatusBadge` (+ `EXAM_STATUS_TONE`, one canonical status→colour mapping),
`Label`, `Input`, `Textarea`, `Select`, `Field`, `Tabs`, `TableWrap`/`THead`/`TBody`/`Tr`/
`Th`/`Td`, `EmptyState`, `LoadingState`, `ErrorState`, `Alert`, `Modal`, `Toast`, plus the
`cn` class helper. `AppShell` + role navigation (`STUDENT_NAV`, `LECTURER_NAV`, `ADMIN_NAV`)
provides the persistent sidebar, mobile drawer and top bar.

### Routes redesigned
| Route / surface | State |
|---|---|
| `/student` | **Fully redesigned** — shell, stats, exam cards, results as cards below `md`, empty/loading states |
| `/lecturer` | **Fully redesigned** — shell + `PageHeader`; exam cards, students, evaluations and integrity-log panels rebuilt on `Card`/table primitives/`StatusBadge`/`EmptyState`; evaluations and integrity log become card lists below `lg`; creation form grouped into labelled sections (Details → Schedule → Languages → Integrity & devices → Answer sheet) with a note pointing at question sets |
| `/admin` | **Shell + tokens** — shell, `PageHeader` retaining its actions, shared `Toast`/`LoadingState`; both tables adopted the shared table language; all 25 form controls and buttons on the tokens |
| `/login`, `/register` | Card surfaces and all controls on the tokens |
| `/` (landing) | Radius and shadow tokens applied |
| Submission Inspector | Header rebuilt on `StatusBadge` — identity, faculty-visible set label, auto-submit and device class read at a glance; integrity status uses the shared badge |
| `AnswerSheet` | Refined into a structured laboratory record: titled header with a live `n/n required` counter derived from the same rule the server enforces, explicit **Required**/**Optional** chips (no longer an asterisk, so state is not colour-only), semantic `<section>` per entry |
| `QuestionSetManager`, `AnswerSheetConfigurator` | Surface tokens applied; still carry their own internal layout |
| `/student/lab/[id]` | Deliberately **not** shell-wrapped — an active examination stays distraction-free |

### Responsive status
Sidebar collapses to a drawer below `lg`; the drawer opens, traps a backdrop, closes on
Escape and dismisses on selection. Dense faculty tables become card lists below `lg`
(evaluations, integrity log) or scroll with an enforced minimum width (students, admin).
Verified with no horizontal page scroll at **1440px, 834px and 390px** for lecturer, and at
1440px/834px for student and 1440px for admin.

### Consistency sweep (second pass)
Every route was inspected in the **light** theme, which is where an unconverted screen shows
itself. Two real defects were found and fixed:

1. **`QuestionSetManager` was hardcoded dark** — zero `dark:` classes — so it opened as a
   dark modal over a light dashboard. It was the clearest remaining "old UI" screen. 57 class
   strings were made theme-aware; it now follows the theme like every other management
   surface.
2. **Four different modal scrim opacities** (`bg-black/50`, `/60`, `/75`, `/80`) across
   dialogs. All 14 now share the one scrim the `Modal` primitive uses.

Also resolved: **every legacy radius and shadow token in the codebase is gone** (0 remaining
occurrences of `rounded-xl`/`rounded-2xl`/`shadow-sm|md|xl|2xl`). The exam surfaces adopted
the shared radius and shadow scale while keeping their deliberately dark, focused palette —
so they read as the same product without losing their distinct character.

`QuestionPaper` gained an explicit `surface` prop, because it renders both inside the
permanently-dark exam modal and inside the theme-following lecturer preview; one set of
colour classes could not serve both correctly.

### Dialog standardisation (third pass)
All 16 overlays in the application were inspected. **Ten migrated** to the shared `Modal`:
six admin dialogs (create/edit branch, subject and faculty; edit student; reset password;
view profile), the lecturer exam-creation dialog, the Submission Inspector, the Question Set
Manager and its nested set preview, the answer-sheet preview, and the profile/settings
dialog.

**Four intentionally remain custom, and why:**
- `ExamGuard`'s fullscreen-required gate — a blocking integrity barrier, not a dialog. It
  deliberately has no Escape, no backdrop dismissal and no close button; dismissing it is
  exactly what a student must not be able to do.
- `OnlineIDE`'s problem-statement and new-file overlays (×2) — inside the permanently-dark
  examination surface. Routing them through the themed primitive would drop a light panel
  into the middle of a deliberately dark, focused exam.
- (The tenth item, the AppShell mobile drawer, is navigation rather than a dialog.)

The primitive gained the behaviours the migration required: focus trap, focus restoration,
background scroll lock, an open-dialog stack so **Escape dismisses only the topmost dialog**,
`elevated` for nested dialogs, `fullHeight` for review workspaces, and `dismissOnBackdrop`.

**A real bug was found and fixed by this testing:** with a nested preview open, Escape closed
*both* it and its parent workspace, because every mounted Modal heard the same window
keydown. The dialog stack fixes it.

**`dismissOnBackdrop` is false** for every dialog holding unsaved input — admin forms, exam
creation, the question-set workspace, grading and settings — preserving their previous
behaviour, which never dismissed on outside click. Making them backdrop-dismissible would
have been a regression that silently discarded typed work.

**Accessibility gained across ten dialogs:** `role="dialog"`, `aria-modal`, an accessible
name, focus moved in on open and restored on close, Tab trapped inside, and the background
made non-scrollable.

**Responsive verification:** 111 assertions across 1440 / 834 / 390 px — every dialog fits
its viewport in both dimensions, causes no page overflow, locks background scroll, receives
focus, resists backdrop dismissal where it should, and closes on Escape.

### Landing page (fourth pass)
`/` was a single centred hero with a logo, title, two buttons and a footer. It is now a
sectioned entry point built from the shared design system: header with sign-in actions, hero,
"what it is", the nine-step examination workflow as an ordered list, a nine-item capability
grid, an integrity note, a closing call to action, and a footer.

**Every capability named is verified as implemented** before being written — the answer-sheet
configurator, question sets and their random assignment, hidden set identity, the execution
engine, run capture into the record, the integrity log, the device restriction and manual
evaluation. The page carries **no invented statistics, institutions, partnerships or
testimonials**, and explicitly states that there is no auto-grading rather than implying
otherwise. The integrity section repeats the honest limitation: the device check is a
deterrent, not attestation.

One correction of substance: the old tagline called LabSubmit a "Programming Laboratory
Management & Code Execution Portal", which reduces it to online coding. The hero now states
it is a digital laboratory examination and evaluation platform, matching the product
direction in CLAUDE.md.

`Navbar` gained an optional `actions` slot so the public pages can carry sign-in actions
without a second navigation component.

### Known UI issues / limitations
- Verified at three viewport widths (1440/834/390), not a full device matrix.
- `QuestionSetManager` and `AnswerSheetConfigurator` are now theme-correct and on the tokens,
  but still compose their own layout rather than using the shared primitives.
- Admin tables use the shared table *language* by class replacement rather than the
  `TableWrap`/`Th`/`Td` components, and have no mobile card fallback (they scroll).
- The two exam-surface overlays remain hand-rolled by design (see above); they therefore
  lack Escape-to-close and dialog ARIA. Documented rather than forced into the primitive.
- The landing page copy is maintained by hand; if a capability is ever removed, the page
  must be updated with it.
- Two navigation surfaces coexist below `lg` on lecturer/admin: the drawer and the original
  tab strip (the strip is now `lg:hidden`). Intentional for now, but slightly redundant.
- The shell renders navigation from a static per-role list; it does not reflect permissions
  beyond role.

### Next UI/UX tasks
1. Rebuild `QuestionSetManager` and `AnswerSheetConfigurator` bodies on the primitives (their
   dialog shells are now shared; their internals still compose their own layout).
2. Rebuild admin tables on the table primitives with mobile card fallbacks.
3. Faculty tables → mobile card fallbacks on the admin side.

---

## 4. Known limitations

- **Set assignment is not re-balanced retroactively.** Adding a set mid-exam means students
  who already hold one keep it, so the spread can end uneven if sets are added after
  assignments exist. This is deliberate — re-drawing would swap a student's paper underneath
  them — and the lecturer can even it out with per-student reassignment if they choose.
- **A deactivated set does not redistribute its students.** Deactivating removes a set from
  future assignment only; students already holding it keep it.
- **Eligibility is year plus branch.** Assignment generation targets every student matching
  the exam's year and branch. There is no per-exam enrolment list, so a student in that
  cohort who was never meant to sit the paper would still receive an assignment (they simply
  never start it).
- **Overriding a live set edit rewrites papers in place.** The override exists because a
  lecturer may need to fix a broken question mid-exam, and it is audited — but a student who
  already answered against the old wording is not notified, and their existing answers are
  not migrated.
- **Input/Output sections remain student-attested.** "Use last run" fills them from a real
  execution, but a student may still edit the text afterwards or type it by hand, and runs
  are not persisted server-side. The captured content is a convenience and an accuracy aid,
  not proof of what executed.
- **Run capture is in-memory and per-session.** Only the most recent run is offered, and it
  is lost on reload. Nothing is stored.
- **Devtools detection is shortcut-only.** F12 and Ctrl+Shift+I/J/C are intercepted; an
  already-open panel, or one opened via the browser menu, is not detected. There is no
  reliable cross-browser API for this.
- **Fullscreen cannot be forced.** The browser may refuse or a student may decline; the
  system detects and logs the exit rather than preventing it.
- **Device classification is heuristic, and cannot be otherwise.** A browser cannot prove
  what hardware it runs on. The check reads the `User-Agent` and the `Sec-CH-UA-*` client
  hints, all of which the client ultimately controls. Specifically:
  - A student who spoofs a desktop User-Agent (developer tools, a browser extension, a
    custom build, or desktop-mode on a mobile browser) **will** be treated as eligible.
  - iPadOS 13+ sends a desktop Safari User-Agent by design. It is caught only by a
    client-side hint (touch points on a reported Mac), which a modified client can suppress.
  - A browser that sends no User-Agent is refused at exam start but allowed to continue an
    attempt already under way, deliberately, so an ambiguous signal cannot strand a student
    mid-paper.
  This raises the effort required to sit an exam on an unsupported device; it is **not**
  attestation and must not be presented to faculty as one. It belongs alongside the
  integrity log as a signal, not as a guarantee.
- **The exam workspace assumes a wide viewport.** The IDE has a fixed-width file sidebar and
  the answer-sheet/code split assumes desktop. This is deliberate and consistent with the
  desktop-only exam policy — the exam page is the one screen that is not made responsive.
- **The responsive pass was verified at one phone width (390px) and by reading layouts, not
  across a device matrix.** Faculty data tables still scroll horizontally on a phone by
  design; that is appropriate for dense multi-column data but is not the same as a
  purpose-built mobile faculty view.
- **Grading remains a single flat mark** despite per-section weighting being configurable.
- **No notices module exists**, though notices are named in the product direction as
  mobile-accessible content.
- **Auto-submit depends on a reachable server.** The lazy deadline check self-heals on the
  next action, but a student who closes their laptop mid-exam is finalised only when
  something next touches the workspace.

---

## 5. Technical debt

- **`README.md` is stale.** It documents an `/api/compile/run` route that no longer exists,
  describes SQLite as the default database (the project is PostgreSQL-only), and lists a
  folder structure predating the execution engine and exam layers. It should not be trusted
  as documentation.
- **No automated test suite in the repository.** The verification described above was run
  as throwaway scripts against a temporary database and a headless browser, not committed as
  tests. There is no `npm test`, no CI, and no regression safety net.
- **`npm run lint` is not usable.** The script exists but no ESLint config does, so
  `next lint` drops into interactive first-time setup instead of linting. Either configure
  it or remove the script.
- **No `prisma/migrations/`.** Schema evolves by `db push`. Additive changes are safe;
  renames and drops carry real data-loss risk on a live database, and there is no history
  of how the schema reached its current shape.
- **`src/app/admin/page.tsx` (1171 lines) and `src/app/lecturer/page.tsx` (~980 lines)** are
  large single-file dashboards mixing data fetching, form state and presentation. Tab
  contents are prime candidates for extraction.
- **`any` is used pervasively** for API payloads in page components. There are no shared
  request/response types between routes and their consumers, so an API shape change fails
  at runtime rather than at compile time.
- **`OnlineIDE` fetches its own workspace** in addition to receiving `initialFiles` from its
  parent — two sources of truth for the same data. In the faculty inspector that fetch
  fails silently (a lecturer token cannot call the student endpoint) and the component
  falls back to props, which works by accident rather than design.
- **The JWT secret has a hardcoded development fallback** in `src/lib/jwt.ts`. If
  `JWT_SECRET` is ever unset in production, tokens become forgeable with a value that is in
  the repository.
- **Violation type strings are duplicated** across the schema comment, `examIntegrity.ts`,
  the violations route allowlist and `ExamGuard`. A shared enum would prevent drift.
- **Next.js 14.2.10 has a known security advisory** (flagged at install). An upgrade should
  be scheduled.

---

## 6. Next implementation steps

Ordered by dependency. Steps 1 and 2 finish work whose schema already exists.

1. **Question-set authoring and multi-question sets.**
   Extend `QuestionSet` from a single statement to an ordered collection of questions
   (a `Question` child model), add lecturer CRUD for sets and their questions in the exam
   modal, and surface the assigned set's questions to the student. The random-assignment
   path already exists and should be reused unchanged. Keep the identity-stripping rule
   intact as the payload grows — a question list must not leak set size or ordering.

2. **Per-exam enrolment (optional).** Assignment eligibility is currently year plus branch.
   An explicit enrolment list per exam would let a lecturer sit a subset of a cohort.

3. **Persist execution records.**
   Client-side capture and answer-sheet insertion are done; the server still stores nothing.
   Persist an `ExecutionRecord` per run in `ExecutionController` (the `system` output flag
   already separates program output from platform banners), surface a student's run history
   in the evaluator view, and mark whether an Output section matches a real recorded run.
   Mind the 5 MB output cap and truncate before persisting.

4. **Section-wise evaluation.**
   Write `SectionEvaluation` rows from the inspector, roll them up into
   `Submission.marks`, and show the breakdown to the student alongside published results.

5. **Mobile audit of the general UI.**
   Verify and fix dashboards, results, login and registration at phone widths. The exam
   page is deliberately out of scope — it is desktop-only by policy.

6. **Notices module.**
   A lecturer/admin-authored notice feed visible to students, mobile-first, outside the
   exam flow.

7. **Debt reduction, ongoing.**
   Rewrite `README.md`; commit the verification scripts as a real test suite; introduce
   shared API types; extract dashboard tabs into components; remove the JWT fallback
   secret.
