# STATE.md — LabSubmit implementation status

A factual snapshot of what exists in this repository. Companion to `CLAUDE.md`
(product direction and engineering rules).

**Last updated:** 2026-09-01, after full repository inspection and the answer-sheet /
device-policy work on `claude/labsubmit-development-y605fv`.

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
- Create / edit / delete / publish examinations, scoped to the lecturer's assigned
  subjects; drafts stay hidden from students.
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
  PENDING), and a publish toggle controlling student visibility.
- `NEEDS_CORRECTION` reopens the student's workspace for resubmission.
- Student results view showing only published marks and remarks.

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

### Verification performed
- `tsc --noEmit` and `next build` clean.
- Unit assertions over device classification (real UA strings for Windows, macOS, Linux,
  Android phone/tablet, iPhone, iPad, absent UA) and over answer-sheet normalisation and
  required-section validation.
- End-to-end run against a live PostgreSQL instance covering: device block on phone,
  a phone spoofing a desktop header, desktop start succeeding, section save/overwrite,
  rejection of a foreign section id, rejection of typing into the Code section, submit
  blocked while required sections are blank, submit succeeding once complete, custom
  format authoring, injected-unknown-section rejection, and format reconfiguration
  preserving answers.

---

## 2. In progress

These have **database schema and, where noted, partial runtime support**, but are not
usable end to end.

### Randomized question sets — runtime path done, authoring missing
- `QuestionSet` model and `LabWorkspace.questionSetId` exist.
- Random assignment **is implemented and live**: `pickQuestionSetId()` draws at random from
  the least-used active sets (random, but evenly spread), pins the set to the workspace on
  `start_exam`, and never re-draws.
- Student payloads resolve the assigned set's statement and **strip the set identity**;
  when sets exist but none is assigned yet, the statement is withheld entirely.
- Lecturer submission payloads expose `questionSetLabel` — the student-to-set mapping is
  visible to evaluators, as required.
- **Missing:** any way for a lecturer to *create* a set. There is no authoring API and no
  UI. With no sets in the database the code falls back to `Lab.problemStatement`, which is
  exactly today's behaviour — so the feature is currently inert in practice.
- **Missing:** a set currently holds a *single* `problemStatement` string. The requirement
  that a set contain a lecturer-defined number of questions is **not** modelled yet.

### Input/output capture
- `ExecutionRecord` model exists. **Zero code reads or writes it.**
- Execution output is currently ephemeral: it streams to the student's terminal and is
  gone. Nothing about a program run is persisted for the evaluator.
- The Input and Output answer-sheet sections are presently free-text — the student types
  what they ran, and it is not cross-checked against an actual execution.

### Section-wise evaluation
- `SectionEvaluation` model exists. **Zero code reads or writes it.**
- Per-section `maxMarks` is configurable and displayed, but evaluation still records a
  single flat total on `Submission`. No breakdown is captured.

### Mobile compatibility of the general UI
- Data tables are wrapped in horizontal-scroll containers, and dashboards carry some
  responsive breakpoints (student 7, lecturer 14, admin 14 breakpoint utilities).
- Login and registration pages use centred cards with **no** explicit breakpoints.
- No page has been audited or tested at phone widths. Treat general mobile compatibility as
  *plausible but unverified*, not delivered.

---

## 3. Newly planned (agreed requirements)

Recorded so intent is not lost. Items marked ✅ are delivered; the rest are outstanding.

| # | Requirement | Status |
|---|---|---|
| 1 | Unified customizable answer-sheet examination model | ✅ Complete |
| 2 | Multiple randomized question sets | ⏳ Assignment done; authoring and multi-question sets outstanding |
| 3 | Hidden student set identity | ✅ Complete (payloads strip it server-side) |
| 4 | Lecturer-visible assignment mapping | ✅ Complete (`questionSetLabel` in the inspector) |
| 5 | Mobile-compatible general application | ⏳ Partial, unaudited |
| 6 | Desktop/laptop-only active exams | ✅ Complete, enforced server-side at all entry points |
| 7 | Digital record containing configurable sections | ✅ Complete |
| 8 | Code execution with input/output capture | ⏳ Execution complete; capture not started |
| 9 | Lecturer manual evaluation workflow | ⏳ Works at submission level; section-wise marking not started |

---

## 4. Known limitations

- **Question sets are inert.** Because no authoring path exists, no examination can
  actually have more than one set today.
- **A question set holds one statement, not many questions.** The model does not yet match
  the requirement.
- **Input/Output sections are unverified self-reports.** A student types what they claim
  they ran; nothing ties it to a real execution.
- **Devtools detection is shortcut-only.** F12 and Ctrl+Shift+I/J/C are intercepted; an
  already-open panel, or one opened via the browser menu, is not detected. There is no
  reliable cross-browser API for this.
- **Fullscreen cannot be forced.** The browser may refuse or a student may decline; the
  system detects and logs the exit rather than preventing it.
- **Device classification is heuristic.** A determined student on a rooted device with a
  spoofed User-Agent and a desktop-class browser could present as a desktop. The check
  raises the cost of cheating substantially; it is not a hardware attestation.
- **The exam workspace assumes a wide viewport.** The IDE has a fixed-width file sidebar;
  the answer-sheet/code split assumes desktop. This is consistent with the desktop-only
  exam policy but means the exam page itself is not responsive.
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
  as throwaway scripts against a temporary database, not committed as tests. There is no
  `npm test`, no CI, and no regression safety net.
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

2. **Input/output capture.**
   Accumulate the stdin keystroke stream and stdout per run in `ExecutionController` and
   persist an `ExecutionRecord` on exit. Surface the student's runs in the evaluator view,
   and let the student attach a real run to their Input/Output sections instead of
   retyping it. Mind the 5 MB output cap and truncate before persisting.

3. **Section-wise evaluation.**
   Write `SectionEvaluation` rows from the inspector, roll them up into
   `Submission.marks`, and show the breakdown to the student alongside published results.

4. **Mobile audit of the general UI.**
   Verify and fix dashboards, results, login and registration at phone widths. The exam
   page is deliberately out of scope — it is desktop-only by policy.

5. **Notices module.**
   A lecturer/admin-authored notice feed visible to students, mobile-first, outside the
   exam flow.

6. **Debt reduction, ongoing.**
   Rewrite `README.md`; commit the verification scripts as a real test suite; introduce
   shared API types; extract dashboard tabs into components; remove the JWT fallback
   secret.
