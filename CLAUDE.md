# CLAUDE.md — LabSubmit engineering context

Guidance for Claude Code (and any contributor) working in this repository.
`STATE.md` is the companion file: this file is *what LabSubmit is and how to build it*,
`STATE.md` is *what currently exists*. Read both before making changes.

---

## 1. What LabSubmit is

LabSubmit is a **digital laboratory examination and evaluation platform** for college
programming labs. It is not an online code editor with a submit button, and it should not
be designed as one. The editor is one component inside a larger examination workflow.

The platform covers:

- **Digital laboratory examination** — scheduled, invigilated, time-bound exam attempts
  with integrity monitoring.
- **Digital lab-record / answer-sheet workflow** — the student completes a structured
  written record (the digital equivalent of a physical lab record book), not just code.
- **Live code execution** — students compile and run their programs interactively during
  the exam, in a real terminal.
- **Randomized question-set assignment** — a lecturer authors several sets per exam and
  the platform assigns one to each student at random.
- **Lecturer / evaluator assessment** — a human evaluator reviews the complete
  submission (written record + code + I/O + integrity signals) and awards marks manually.
  There is no auto-grading.
- **Result management** — marks, remarks and evaluation status are recorded and
  published to students under the lecturer's control.

---

## 2. The core unified examination workflow

There is **one** examination model. Every exam follows this pipeline:

```
Lecturer configuration
  → answer-sheet customization
    → question-set creation
      → randomized assignment
        → student examination
          → code execution
            → submission
              → lecturer evaluation
                → results
```

Each stage is a step in a single flow, not a separate product mode. When adding a feature,
work out which stage it belongs to and extend that stage.

---

## 3. Answer-sheet customization

**The answer sheet is NOT a fixed, hardcoded format.** Do not implement Aim / Algorithm /
Output and so on as separate exam types, templates or formats. They are *sections of one
sheet*, and the lecturer decides which of them a given examination uses.

Standard available sections currently include:

| Section     | Notes                                                     |
|-------------|-----------------------------------------------------------|
| Aim         | Written by the student                                     |
| Description | Written by the student                                     |
| Algorithm   | Written by the student                                     |
| Procedure   | Written by the student                                     |
| Code        | Bound to the workspace source files, not a free-text box   |
| Input       | The input supplied to the program                          |
| Output      | The output the program produced                            |
| Conclusion  | Written by the student                                     |
| Iteration   | Optional refinements / retries                             |

Rules:

- Sections may be **enabled or disabled** per examination.
- Sections may be **reordered** by the lecturer.
- Section **headings are editable** by the lecturer (a lecturer may prefer
  "Objective of Experiment" over "Aim").
- **Required / optional** status is configurable per section and must be represented and
  enforced where the architecture supports it.
- **Marks / weighting** per section should be represented where the architecture supports
  it, rolling up into the submission total rather than replacing it.
- The catalogue of *which* sections can exist is server-side. A client must never be able
  to invent a section, or change a section's kind (e.g. turn Code into free text).

When a section list grows, extend the catalogue — do not fork the model.

---

## 4. Question sets

- A lecturer can create **multiple sets for one examination**.
- Each set can contain a **lecturer-defined number of questions**.
- A student is assigned **one set at random** when their attempt starts, and that
  assignment is pinned to their workspace for the rest of the attempt.
- **Students must never be shown the set identifier.** They see the questions only. No set
  label, no set number, no set count, no ordering that would let a student infer which set
  they hold or compare with a neighbour. This is a payload-shaping rule, not a UI rule:
  strip the identity server-side before it leaves the API.
- **Lecturers and evaluators can see the internal student-to-set mapping**, because it
  matters for evaluation and for investigating irregularities.

---

## 5. Device policy

- The **general LabSubmit UI must be responsive and mobile compatible**. Students are
  expected to use phones for dashboards, notices, instructions, results and grades.
- **An active examination attempt is desktop/laptop only.** A student must not be able to
  start or continue a live exam on a phone or tablet.
- **The device restriction must not rely exclusively on frontend UI hiding.** Hiding a
  button with CSS or a JavaScript check is not enforcement. The decision must be made
  server-side from request data, and must be applied at *every* entry point into an
  attempt — REST actions and the execution WebSocket alike — because any unguarded
  entry point is the whole bypass.
- Client-side device signals may be used to *narrow* eligibility (some devices, notably
  iPadOS, deliberately misreport themselves as desktops), but must never be able to
  *widen* it. A client can volunteer that it is a tablet; it can never talk its way into
  being treated as a desktop.
- **Exam content is withheld, not hidden.** An ineligible device must not receive the
  questions, the problem statement or the workspace files in any API response. Hiding them
  in the UI is not enough: the payload itself is the leak.

**What device detection can and cannot do.** A browser cannot prove what hardware it is
running on. Detection rests on the `User-Agent` string and the `Sec-CH-UA-*` client hints,
both of which the client ultimately controls. A determined student with developer tools or
a custom browser build can present a desktop User-Agent from a tablet and will be treated
as eligible. This restriction raises the effort required to sit an exam on an unsupported
device; it is not attestation, and it should not be described to faculty as one. Treat it
as one signal alongside the integrity log, not as a guarantee.

---

## 6. Engineering principles

1. **Extend the existing architecture.** Find the module that already owns a concern and
   grow it. New parallel implementations of something that exists are a defect.
2. **Preserve working features.** Existing exams, workspaces and submissions must keep
   functioning across every change. New capabilities default to behaviour identical to
   the old path when unconfigured.
3. **Avoid unnecessary rewrites.** Do not replace the auth model, role system, database
   architecture, execution engine or UI foundation without a concrete technical reason.
   "Cleaner" is not a reason.
4. **Prefer server-authoritative exam state.** Timing, eligibility, submission state,
   violation severity and assignment are decided on the server. Client-side timers,
   guards and counters are conveniences layered on top of a server check, never a
   substitute for one. Assume the client is hostile and offline-capable.
5. **Keep student-facing and lecturer-facing data appropriately separated.** Build the
   student payload from what a student is allowed to know, rather than taking a rich
   internal object and hoping the UI does not render the sensitive parts.
6. **Do not expose internal question-set assignment metadata to students.** Set ids,
   labels, counts and sibling-set content must not appear in any student-facing response —
   including error messages and debug fields.

Supporting conventions:

- **Fail closed on entry, fail open on continuation.** Refusing to *start* an attempt on
  an unverifiable device is correct; locking a student out *mid-paper* over an ambiguous
  signal is not.
- **Automatic submissions are never blocked by validation.** A timeout or integrity
  threshold must always capture whatever work exists, complete or not. Validation gates
  the *manual* submit only.
- **Idempotent state transitions.** Submission and assignment paths are reachable from
  several places; they must converge on one shared helper rather than diverging.
- **Student work is never destroyed to tidy something up.** An examination that any student
  has started, submitted, written a file into, answered a section of, or triggered an
  integrity event on must never be permanently deletable — every relation on `Lab` cascades,
  so a delete takes the submissions, awarded marks and integrity log with it. Such an exam is
  **archived** (`Lab.archivedAt`), which writes one column and destroys nothing. The check is
  re-derived from the database on the server for every request; a client confirmation is a
  courtesy, never the guard. Any future destructive operation on student-owned records
  follows the same shape: refuse with 409, offer the non-destructive alternative, and state
  in the refusal exactly what exists.
- **Destructive administrative actions are audited.** Deleting, archiving or restoring an
  exam, and overriding a live question set or an assignment, write an `ExamAdminAction` row
  recording the actor, the exam and what happened. That model is the one audit trail — do not
  add a parallel one. Its `labId` is nullable with `onDelete: SetNull` and it snapshots
  `labTitle`, because the record of a deletion has to outlive the thing it records.
- **One lifecycle, extended — never a second status system.** `getExamStatus()` in
  `examTiming.ts` is the single source of an exam's state (`DRAFT`, `UPCOMING`, `RUNNING`,
  `COMPLETED`, `ARCHIVED`). New lifecycle states are added there, so every entry point that
  already gates on `RUNNING` — the workspace route and `ExecutionController.authorizeRun()` —
  picks them up without a new check of its own.
- **Pure modules for shared logic.** Rules needed by both server routes and client
  components live in dependency-free modules (no Prisma import) so they can be shared
  without pulling the database client into a browser bundle.
- **Comment the *why*.** Explain non-obvious decisions and the failure they prevent, not
  what the line does.

---

## 7. UI/UX design system

**Design philosophy.** LabSubmit should read as one calm, professional, structured product:
clean surfaces, generous spacing, a clear hierarchy on every page, and restraint with
colour. It is an examination platform for a college, not a consumer app — polish serves
legibility and confidence, never decoration.

**The reference image supplied during the redesign is inspiration, not a target to copy.**
Take from it the *qualities* — spacing, hierarchy, card system, navigation structure,
typography, polish. Never its branding, wording, icons, layouts or product features. The
result must remain unmistakably LabSubmit.

**Functionality outranks appearance.** No visual change may remove a feature, alter exam
security or integrity behaviour, weaken the device restriction, expose question-set
identity, or rewrite business logic to make a layout tidier. If a redesign appears to
require a logic change, that is a signal to redesign differently.

### Shared component strategy

`src/components/ui/index.tsx` is the single source of visual truth. Pages compose from it:
`Button`, `Card`, `SectionCard`, `PageHeader`, `StatCard`, `StatusBadge`, `Label`, `Input`,
`Textarea`, `Select`, `Field`, `Tabs`, `TableWrap`/`Th`/`Td`/`THead`/`TBody`/`Tr`,
`EmptyState`, `LoadingState`, `ErrorState`, `Alert`, `Modal`, `Toast`.

Do not restyle a card, badge or button inside a page. If a primitive is missing, add it to
the library so every page gains it at once.

### Layout system

`src/components/AppShell.tsx` provides the shell: a persistent sidebar on `lg` and above, a
slide-over drawer below it, and a compact sticky top bar. Navigation is role-based
(`STUDENT_NAV`, `LECTURER_NAV`, `ADMIN_NAV`).

**Sidebar items must correspond to destinations that actually exist.** LabSubmit keeps each
role's views as tabs within one route, so a sidebar item selects a section of the current
page. Never add an item for a page the application does not serve.

**The active examination does not use the shell.** An exam is deliberately
distraction-free: no sidebar, no cross-navigation, nothing inviting a student away from a
live attempt. It keeps the design tokens, not the chrome.

Theme tokens live in `tailwind.config.js`: `rounded-card` / `rounded-control`,
`shadow-card` / `shadow-cardHover` / `shadow-overlay`, and `w-sidebar`. Use them rather
than ad-hoc values. Olive is the primary action colour (CBIT's identity); blue is
secondary/informational; amber, rose and emerald carry warning, error and success. Do not
introduce further hues.

### Responsive principles

Mobile, tablet, laptop and desktop must all work for non-exam use. Breakpoints follow
Tailwind defaults; the shell switches at `lg`. Dense data tables may scroll horizontally
inside `TableWrap`, which enforces a minimum width so columns are never crushed — but a
table a student reads often (results) becomes stacked cards below `md` instead. Never let
the page body itself scroll horizontally.

### Answer-sheet UI principles

The student sheet renders **whatever the lecturer configured** — enabled sections, in their
order, under their headings, with their required flags. Never hardcode the section list or
its order into a layout. Required state is shown by more than colour, and the Code section
is bound to the workspace files rather than being a second editor.

### Dialog architecture

Every standard application dialog uses the shared `Modal` primitive. It provides Escape to
close, a focus trap, focus restoration to whatever opened it, background scroll lock,
`role="dialog"` + `aria-modal` + an accessible name, responsive sizing, and a scrollable body.
Do not hand-roll a dialog: extend `Modal` instead.

Two props carry real decisions rather than styling:

- **`dismissOnBackdrop`** — defaults to true. Set it **false** for any dialog holding unsaved
  input (forms, authoring workspaces, grading). A stray click beside a half-filled form must
  not discard the work. Escape still closes, because a deliberate keypress is not a stray
  click.
- **`elevated`** — for a dialog opened from inside another dialog. Escape dismisses only the
  topmost dialog; the primitive tracks an open-dialog stack so a nested preview never takes
  its parent down with it.

**Overlays that are deliberately NOT dialogs** and must stay custom:

- `ExamGuard`'s fullscreen-required gate. It is a blocking integrity barrier, not a dialog:
  it must have no Escape, no backdrop dismissal and no close button, because dismissing it
  is precisely what the student must not be able to do.
- The active examination's own overlays (`OnlineIDE`'s problem statement and new-file
  dialogs). They live inside the permanently-dark exam surface; routing them through the
  themed primitive would put a light panel in the middle of a dark, deliberately focused
  examination.

### Accessibility expectations

Semantic HTML (`nav`, `header`, `main`, `table`, real `button`s); every input has a label;
`aria-current` marks the active nav item and `aria-selected` the active tab; dialogs are
`role="dialog"` with `aria-modal` and close on Escape; loading regions are `aria-live`;
status is never conveyed by colour alone — always a label, often an icon; one consistent
`:focus-visible` ring is defined globally; animation respects `prefers-reduced-motion`.

---

## 8. Architecture map

Next.js 14 App Router + TypeScript, custom `server.js` (HTTP + WebSocket upgrade),
Prisma + PostgreSQL, Tailwind, Monaco, xterm.

**Split deployment:** Vercel serves the UI and REST API; Railway runs the execution engine
(needs `node-pty`, compilers and a persistent WebSocket, none of which work on serverless)
and hosts Postgres. Both read the same database. See `DEPLOYMENT.md`.

| Area | Where |
|---|---|
| Auth / roles | `src/lib/jwt.ts`, `src/lib/auth.ts`, `src/context/AppContext.tsx` |
| Exam timing & status | `src/lib/examTiming.ts` |
| Integrity / violations | `src/lib/examIntegrity.ts`, `src/lib/useViolationLogger.ts` |
| Submission finalization | `src/lib/examSubmission.ts` |
| Answer-sheet catalogue & rules | `src/lib/answerSheet.ts` |
| Exam deletion / archive policy | `src/lib/examLifecycle.ts` (pure), `src/components/ExamRetirementDialog.tsx` |
| Device policy | `src/lib/deviceEligibility.ts` (server), `src/lib/useDeviceClass.ts` (hint) |
| Execution engine | `src/lib/execution/*`, driven by `server.js` |
| Student exam UI | `src/app/student/lab/[id]/page.tsx`, `src/components/OnlineIDE.tsx`, `ExamGuard.tsx`, `AnswerSheet.tsx` |
| Lecturer UI | `src/app/lecturer/page.tsx`, `src/components/AnswerSheetConfigurator.tsx` |
| Schema | `prisma/schema.prisma` |

**Exam entry points that must each enforce policy independently:**
`POST /api/student/workspace` (all actions), and `ExecutionController.authorizeRun()` on
the WebSocket. A rule enforced in only one of these is not enforced.

---

## 9. Commands

```bash
npm run dev        # node server.js — app + execution WebSocket
npm run build      # prisma generate && next build
npm run db:push    # apply schema changes (no migration files in this project)
npm run db:seed    # reset and reseed
npx tsc --noEmit   # typecheck
```

Schema changes are applied with `prisma db push`; this project keeps **no
`prisma/migrations/` directory**. Adding new models/columns is safe; renaming or dropping
requires care, since push will reshape the live table.

`DATABASE_URL` and `JWT_SECRET` must be set. `JWT_SECRET` must be byte-identical between
the Vercel and Railway hosts or the execution engine will reject every token.
