# LabSubmit MVP stabilization report

**Scope:** a full audit of the application as Admin, Lecturer and Student, with every defect
found traced to its root cause, fixed at the owning layer, and covered by a regression test.
**Environment:** local only, meaning the development server (port 3100, `labsubmit_dev`) and the
Docker Compose stack (port 3000, its own Postgres, execution isolation on). Nothing was pushed
or deployed, and no production data was touched.

**Method.** I didn't read the code and guess. I drove the real application:

- a browser crawler logged in through the real login form as each role and opened every
  sidebar destination at desktop and phone width, recording page errors, console errors,
  failed API calls and horizontal overflow;
- a browser script ran the complete workflow across three roles through the UI (§8);
- API tests and engine-level tests covered the rest.

The exam lifecycle bug (exams completing at their start time) was fixed first, in commit
`b5de1c6`; see `EXAM_LIFECYCLE_BUG_REPORT.md`.

---

## 1–3. Bugs found, root causes and fixes

| # | Severity | Bug | Root cause | Fix |
|---|---|---|---|---|
| 1 | **Critical** | Exams went from Upcoming straight to Completed at their start time; students could never enter | Status used `endTime` alone, and nothing checked that end > start (AM/PM slips stored an end before the start) | One window rule (`getExamWindowEnd`), shared schedule validation in form and API, one deadline comparison. Commit `b5de1c6` |
| 2 | **Critical** | **Deleting a lecturer permanently deleted every exam they wrote**, and with them every student's submissions, marks and integrity log, plus the audit trail of their exam actions | `Lab.lecturer` and `ExamAdminAction.actor` are `onDelete: Cascade`; the delete had no guard | Refused with 409 while the lecturer has exams or recorded actions; the message says what exists and suggests reassigning subjects |
| 3 | **High** | The "delete lecturer" endpoint deleted **any** account by id: an administrator, a student, or the caller | No role check in DELETE (PUT and the password reset had one) | 404 unless the target is a lecturer |
| 4 | **High** | Deleting a student who had sat exams deleted their submissions and marks | Workspaces, submissions and violations cascade from the user | Refused with 409 once the student has an attempt, submission or integrity event; suggests a password reset instead |
| 5 | **High** | Deleting a branch silently deleted its subjects and orphaned its exams and students. The exams vanished from every student dashboard, and orphaned students matched every branch's exams in their year | `Subject.branch` cascades; `Lab.branch`, `Lab.subject` and `StudentProfile.branch` are SetNull; no guard. **This is what had already happened to the Docker database's CSE-2 branch** | Refused with 409 while anything refers to it. The non-destructive alternative (close registration) is now available in the branch form |
| 6 | **High** | Deleting a subject hid all its exams, including pending results, from students | Students find exams through their subjects; `Lab.subject` is SetNull | Refused with 409 while the subject has exams |
| 7 | **High** | **A deleted account kept full API access for up to 7 days**, and a changed role kept its old permissions | `requireAuth` trusted the signed JWT alone (7-day expiry) | `requireAuth` now checks that the account exists and still has the token's role (one indexed lookup per request); 401 otherwise. The frontend already signs out on 401 |
| 8 | **High** | The exam IDE depended on a public CDN: the code editor loaded from `cdn.jsdelivr.net`, and so did the terminal's stylesheet. One run hung on "Loading…" for minutes. On a lab network that filters that CDN, no student could write code | `@monaco-editor/react`'s default loader uses jsdelivr; `Terminal.tsx` also injected a redundant CDN copy of `xterm.css` | Monaco is copied from `node_modules` into `public/monaco` at build time (`scripts/copy-monaco.mjs`) and loaded from there; the redundant CSS link was removed (the stylesheet was already bundled). Verified with the CDN **blocked** in the browser |
| 9 | Medium | **JavaScript could not be used at all**, although the engine supported it (it ran `.js` and listed `.js` as supported) | The exam layer (`SUPPORTED_LANGUAGES`, lecturer form, IDE language picker, starter files) never offered it | JavaScript completed end to end as an **opt-in** language: unconfigured and existing exams keep C, C++, Java and Python. Node's heap is capped with `--max-old-space-size=256`, mirroring the JVM's `-Xmx`, because `ulimit -v` prevents V8 from starting. Verified under the Docker sandbox (seccomp and per-run uid) |
| 10 | Medium | Compile and runtime errors showed students the server's temp path (`/var/folders/…/labsubmit_exec_…/main.c`) | Compilers print absolute paths, and Python makes `__main__`'s path absolute | The run's temp directory is stripped from compiler output and from the terminal stream; errors now read `main.c:1:5` and `File "main.py"` |
| 11 | Medium | Python files had no syntax highlighting | `getMonacoLanguage()` had no `python` case | Added |
| 12 | Medium | Branch and subject delete buttons gave no feedback when the server refused | The handlers had no `else` branch | They now show the server's reason |
| 13 | Medium | The lecturer's sidebar items (Examinations, Students, Evaluations, Integrity Log) did nothing until a subject was opened, which looked like dead buttons | Deliberate fallback with no feedback | A lecturer with one subject goes straight in; with several, a message says to open a subject first |
| 14 | Medium | Refreshing the lecturer page lost the open subject and tab | View state was kept in memory only | Saved to `sessionStorage` and restored only if the subject is still assigned to that lecturer |
| 15 | Medium | `npm run lint` could not run (it opened an interactive ESLint setup) | No ESLint configuration or dependencies | `eslint@8.57.1` and `eslint-config-next@14.2.35` (Next's own preset) with `.eslintrc.json`. One error fixed (an unescaped apostrophe, which would also have failed `next build`). 9 `exhaustive-deps` warnings left, see §9 |
| 16 | Low | Every page logged a 404 for `/favicon.ico` | No icon declared | `metadata.icons` points at the existing `cbit-logo.png` |
| 17 | Low | Branch edit and delete buttons were icon-only with no accessible name | Missing `aria-label` | Added |
| 18 | **High (test harness)** | Test S16 (orphaned child processes are killed) **could SIGKILL an unrelated process on the machine running the tests** | It checked the sandboxed child's PID with `process.kill(pid, 0)` on the test runner, and sent `SIGKILL` on a match. Against Docker, the PID is a container PID, so it matched whatever host process had that number | The check now runs inside the engine as a second sandboxed run (`os.kill(pid, 0)`: `ProcessLookupError` means gone, `PermissionError` means alive). It never signals a host process. The probe was validated both ways (PID 1 reports alive, a nonexistent PID reports gone) |

### What I checked that worked correctly

All of these were exercised, not assumed:

- **Accounts:** login, invalid credentials, student self-registration with branch detection
  from the roll number (and a clear error when the academic year doesn't match).
- **Exam lifecycle:** Upcoming, Running and Completed on both dashboards and in the API; entry
  refused before the start; saves and runs refused after the deadline; auto-submit at the
  deadline.
- **Question sets:** set labels hidden from students and visible to lecturers.
- **Answer sheet:** required sections enforced on manual submit.
- **Submissions:** autosave, refresh and recovery, receipts, immutable snapshots.
- **Grading and results:** saving a grade doesn't publish it; release is explicit; students
  see marks only after release.
- **Device policy:** the fullscreen gate after a refresh.
- **Security controls:** cross-user access protections, the hash-chained audit log, and
  sandbox isolation.

---

## 4. Files changed

**Server and API:**
- `src/lib/auth.ts`: account and role re-validation. Every route now `await`s `requireAuth`
  (27 files, a mechanical change).
- `src/app/api/admin/{branches,subjects,lecturers,students}/route.ts`: deletion guards and
  audit records.

**Execution:**
- `src/lib/examTiming.ts`: `javascript` added; `DEFAULT_LANGUAGES` keeps the original four for
  unconfigured exams.
- `src/lib/execution/sandbox.ts`: `NODE_HEAP_FLAGS`.
- `src/lib/execution/CompilerService.ts`: Node heap flag, relative script paths,
  `stripTempDir()`.
- `src/lib/execution/ExecutionController.ts`: strips the temp directory from the PTY stream.
- `src/lib/workspaceBootstrap.ts`: `main.js` starter.

**UI:**
- `src/components/OnlineIDE.tsx`: self-hosted Monaco, JavaScript option, Python highlighting.
- `src/components/Terminal.tsx`: removed the CDN stylesheet injection.
- `src/app/admin/page.tsx`: refusal messages, the "Open for student registration" toggle, a
  "Registration closed" badge, aria-labels.
- `src/app/lecturer/page.tsx`: sidebar behaviour without a subject, view persistence,
  JavaScript option.
- `src/app/student/lab/[id]/page.tsx`: lint fix.
- `src/app/layout.tsx`: icon.

**Build:**
- `scripts/copy-monaco.mjs`, `package.json` (copy step in `build` and `predev`; `monaco-editor`
  pinned at the already-installed 0.57.0; ESLint dev dependencies), `.eslintrc.json`,
  `.gitignore` (`public/monaco/`).

**Tests:** `tests/admin-deletion.test.mjs`, `tests/languages.test.mjs` (new); `tests/security-module.test.mjs` (S16 now probes inside the engine).

## 5. Tests added

- **`tests/admin-deletion.test.mjs`** (8 tests): each deletion guard; non-lecturer targets;
  empty records still delete and are audited; a deleted account's token is refused at once; a
  token whose role no longer matches is refused. All 6 deletion tests were run against the
  old build and **failed there**, proving they catch the bugs.
- **`tests/languages.test.mjs`** (10 tests): C, C++, Java, Python and JavaScript each run with
  stdin; no temp path in compile errors or Python tracebacks; JavaScript refused (for runs and
  new files) in an exam that didn't opt in; unconfigured exams keep the four defaults;
  `stripTempDir` handles both macOS path spellings.
- **Earlier in this round:** `tests/exam-lifecycle.test.mjs` (8) and
  `tests/exam-lifecycle-api.test.mjs` (5).
- **Browser workflow and role crawler:** scripts kept outside the repository (they need
  Playwright and a local Chrome; see §9). Their results are in §6 and §8.

## 6. Tests executed (actual results)

| Run | Result |
|---|---|
| Full suite, local server | **166 tests: 163 pass, 0 fail, 3 skipped** (the 3 need Linux isolation; they ran on Docker) |
| Full suite, Docker stack, isolation required | **166/166 pass, 0 skipped** |
| `npx tsc --noEmit` | Clean |
| `npm run lint` | **0 errors**, 9 warnings |
| `npm run build` | Compiles; the Monaco copy step runs |
| Three-role browser workflow, local | 24/24 |
| Three-role browser workflow, **Docker** | **24/24** |
| Admin and lecturer UI fixes, Docker | 5/5 |
| Role crawler, all roles, desktop and phone, Docker | No page errors, console errors, failed API calls or horizontal overflow |

## 7. Docker

- The image builds, with Monaco copied into it.
- Both services are healthy: Postgres, and the app on port 3000.
- The startup log reads `identity=per-run uid 20000-20099; network/syscall filter=seccomp
  launcher; required=true`.
- `/monaco/vs/loader.js` is served by the app (200).
- All five languages run under the sandbox, and the isolation tests pass.

## 8. Features verified end to end

Verified in a real browser on the Docker build, with the public CDN blocked:

1. A student self-registers; branch IT-2 and Year 2 are detected from the roll number.
2. The lecturer signs in, opens the subject, and creates an exam with the form. The form shows
   the actual window before saving, and the exam is stored as configured.
3. The lecturer adds a question set and a question.
4. The student sees the exam under Upcoming, with no Start button before the start time. At
   the start, both dashboards show Running.
5. The student starts the exam and never sees a set label. They fill the six configured
   answer-sheet sections, create a Python file through the language picker, write code in the
   editor, and run it with stdin (`avg wait 4.33`). No server path appears anywhere.
6. The student submits and gets a receipt; an immutable snapshot holding the code is stored.
7. The lecturer inspects the submission and sees the answer sheet, the student's question with
   their set label, and the code. They grade it APPROVED with 8 marks; it is **not** published.
8. Before release, the student's Results page doesn't show the mark.
9. The lecturer releases results, and the student sees **8/100** and the remark.
10. No uncaught errors and no 5xx responses in either session.

## 9. Remaining issues

**Critical or high:** none known.

**Medium:**
- **The Docker database has orphaned demo data from the earlier branch deletion.** Seed Exams 1
  and 3 have no branch or subject, so students can't see them, and seed student Rahul
  (`160125733078`) has no branch, so he matches every Year 2 branch. The guards now prevent
  this from recurring. Repairing the existing rows means re-pointing them at a branch, which
  is a data decision, so I left them as they are. A fresh `db:seed` of a new database doesn't
  have this problem.
- **Password resets don't sign out sessions already open on that account.** Deleted accounts
  and role changes are now cut off immediately. Revoking on password change needs a
  per-account token version (a new column); I didn't add a schema change for it.

**Low:**
- **9 lint warnings** (`react-hooks/exhaustive-deps`) on fetch-on-mount effects. Adding the
  suggested dependencies would re-fetch on every render. Fixing them properly means wrapping
  the fetchers in `useCallback`; it's cosmetic for now.
- **Exams that cross midnight** are refused with a clear message, because the form has one
  date. Supporting them is a product decision.
- **Browser scripts aren't in the repository.** They need Playwright and a local Chrome, which
  the project doesn't depend on.
- **Test data has accumulated** in both local databases (titles starting `e2e`, `lifecycle_`,
  `lifeide_`, `admdel_`, `lang_`, and registered students `e2e… Priya Sharma`). Exams with
  submissions are delete-protected by design, so I left them.

**Incident during testing: a host process killed.** On 2026-11-10, the old S16 test (bug 18) ran
in the full suite against Docker. Its container PID, 692, matched a user-owned process on the
Mac, and the test sent that process `SIGKILL`. The process is gone; its neighbours in that
range are all macOS background agents and helpers started at boot, which launchd restarts on
demand. My five follow-up single-test reruns stopped at an earlier assertion and never reached
the kill, and earlier passing runs never matched a live process, so this was the only one. If
anything on the Mac misbehaves, a restart clears it. The test is fixed (bug 18).

**Incident during testing (resolved):** while proving the admin-deletion tests catch the bug,
I ran them against the old Docker build, whose missing role check deleted the Docker stack's
`admin@cbit.in` account. I recreated it with the same email and password (`admin@123`). It has
no exam-action records to lose. Its 11 earlier audit entries remain in the audit log under the
old account id. The test now uses a throwaway admin, so it can't do this again.

## 10. What I need from you

1. **Review the changes, and tell me whether to push.** Nothing has been pushed.
2. **Production deployment** still needs the manual steps in
   `SECURITY_BLOCKER_CLOSURE_REPORT.md` and `DB_MIGRATION_PLAN.md`. This round adds no schema
   change. After deploying, check whether production has exams with broken schedules: they
   will show a warning on the lecturer's exam card.
3. **Optionally**, decide what to do with the orphaned demo exams and student in the Docker
   database, or reseed a fresh Docker database.
4. **Fix your "Test" exam's schedule** in the Docker stack; it has an end time before its start.
