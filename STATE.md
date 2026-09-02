# STATE.md — LabSubmit implementation status

A factual snapshot of what exists in this repository. Companion to `CLAUDE.md`
(product direction and engineering rules).

**Last updated:** 2026-09-01, after the visual-consistency sweep across every route on
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

### Known UI issues / limitations
- Verified at three viewport widths (1440/834/390), not a full device matrix.
- `QuestionSetManager` and `AnswerSheetConfigurator` are now theme-correct and on the tokens,
  but still compose their own layout rather than using the shared primitives.
- Admin tables use the shared table *language* by class replacement rather than the
  `TableWrap`/`Th`/`Td` components, and have no mobile card fallback (they scroll).
- Lecturer/admin/QuestionSetManager dialogs are still hand-rolled rather than using the
  shared `Modal`, so Escape-to-close and the dialog ARIA roles are inconsistent between
  them and the primitive.
- The landing page is on the tokens but has had no layout pass.
- Two navigation surfaces coexist below `lg` on lecturer/admin: the drawer and the original
  tab strip (the strip is now `lg:hidden`). Intentional for now, but slightly redundant.
- The shell renders navigation from a static per-role list; it does not reflect permissions
  beyond role.

### Next UI/UX tasks
1. Move the hand-rolled dialogs onto the shared `Modal` — this also gives them consistent
   Escape-to-close and dialog ARIA, which currently differ per dialog.
2. Rebuild `QuestionSetManager` and `AnswerSheetConfigurator` on the primitives.
3. Rebuild admin tables on the table primitives with mobile card fallbacks.
4. Give the landing page a layout pass.

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
