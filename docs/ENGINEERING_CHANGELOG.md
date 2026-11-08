# ENGINEERING_CHANGELOG.md

One entry per engineering-loop iteration. Results are the actual output of the commands
listed; nothing is recorded as passing that was not run.

---

## Iteration 0 — Audit · 2026-11-08

**Objective.** The implementation brief referenced `PROJECT_AUDIT.md`, `SYSTEM_ARCHITECTURE.md`,
`SECURITY_AUDIT.md`, `MVP_ROADMAP.md` and `ENGINEERING_STATE.md`; none existed. Produced them
from a read of the code at `85240d1`.

**Key result.** The product lifecycle is functionally complete (per `STATE.md` and confirmed
by reading the routes). The highest-priority defects are security issues in the execution
engine and auth, recorded as S1–S12 in `SECURITY_AUDIT.md`.

---

## Iteration 1 — Execution engine containment (S1, S2, S3, S4 partial) · 2026-11-08

**Objective.** Student code must not be able to read server secrets, write outside its run
directory, or inject shell into compilation; add per-process resource limits.

**Changes.**
- `src/lib/sourceFilename.ts` (new, dependency-free): the single filename rule.
- `src/lib/execution/sandbox.ts` (new): allow-listed env, `ulimit` wrapper (CPU, file size,
  memory for C/C++/Python), Java heap flags, optional uid drop via `EXEC_RUN_UID/GID`,
  resolved-path check.
- `CompilerService.ts`: `exec(string)` → `execFile` argument arrays; validated + resolved
  paths; minimal env; limits; runs as the drop uid when configured.
- `PtyService.ts`: minimal env, limit wrapper, uid drop; removed debug logging of spawn args.
- `ExecutionController.ts`: rejects unsafe filenames, >20 files or >1 MB source *before*
  authorisation or any filesystem access (`INVALID_FILENAME`, `SOURCE_TOO_LARGE`).
- `api/student/workspace` `create_file` / `rename_file`: same filename rule.
- `tests/helpers.mjs`, `tests/execution-security.test.mjs`; `npm test`.

**Tests executed.**
- Baseline (unfixed code, live server + Postgres + real compilers): 6 regression tests pass;
  S1, S2 (×2), S3, S4 **fail**, and traversal files were observed written into `$TMPDIR` —
  the attacks were real.
- After fix: `npm test` → **12 pass, 0 fail**; no stray files in `$TMPDIR`.
- `npx tsc --noEmit` → clean.

**Environment issue found.** `node-pty@1.1.0` ships its macOS `spawn-helper` without the
execute bit, so *every* local run failed with `posix_spawnp failed` until
`chmod +x node_modules/node-pty/prebuilds/darwin-*/spawn-helper`. Linux (Railway) builds from
source and is unaffected. Documented for local developers.

**Remaining.** Linux-only behaviour (memory `ulimit -v`, `/proc` environ test, uid drop) not
executed — Docker daemon was not running. Enabling the uid drop in the `Dockerfile` changes
production deployment and needs owner approval. No network isolation.

---

## Iteration 2 — Token secret, exam-paper exposure, file IDOR (S5, S6, S12) · 2026-11-08

**Objective.** No token may be signed or verified with a public secret; students must not
read exam papers outside their own live attempt; students must not modify others' files.

**Changes.**
- `src/lib/jwt.ts`: removed the hardcoded fallback; throws if `JWT_SECRET` is unset or equals
  the legacy published value; HS256 pinned on sign and verify.
- `api/lecturer/labs` `GET`: `STUDENT` removed from allowed roles (no student UI used it).
- `api/student/workspace`: `save_file` / `rename_file` / `delete_file` refused (404) unless the
  file belongs to the caller's workspace.
- `tests/access-control.test.mjs` (12 tests, self-cleaning fixtures). `npm test` script fixed to
  use a glob — Node 24's runner rejects a bare directory.

**Tests executed.**
- Baseline: S6, S12 (×2), S5 (×2) **failed** — including a live reproduction of student A
  overwriting student B's code (HTTP 200).
- After fix: `npm test` → **23 pass, 0 fail**; `tsc --noEmit` clean; admin dashboard endpoints
  (`/api/lecturer/labs`, `/api/admin/stats`) return 200 for an admin token; 0 fixture rows left.

**Operational note.** Any host where `JWT_SECRET` is unset will now refuse logins. Confirm it
is set (identically) on Vercel and Railway before deploying this commit.

---

## Iteration 3 — Login hardening (S7) · 2026-11-08

**Objective.** Login must not reveal which accounts exist and must bound password guessing,
without affecting legitimate sign-in for any role.

**Changes.**
- `src/lib/rateLimit.ts` (new): in-memory failure limiter (per account 10 / per address 100,
  15-minute window); successes clear the account counter.
- `api/auth/login`: one message for unknown account and wrong password; dummy bcrypt compare
  for unknown accounts (timing); role-tab messages only after a correct password; 429 with
  `Retry-After` while locked; 500 no longer echoes `error.message`.
- `tests/auth.test.mjs` (7 tests).

**Tests executed.**
- Baseline: 3 S7 tests **failed** (distinct messages; no throttling); 4 regression tests passed.
- After fix: `npm test` → **30 pass, 0 fail** against the dev server; `npm run build` succeeds;
  `npm test` → **30 pass, 0 fail** against the production server (`NODE_ENV=production`), where
  the S4 privilege-drop warning was observed in the log as designed.

**Remaining.** Limiter is per instance (not global on Vercel). Account lockout can be
triggered by a third party for one window — documented trade-off.

---

## Iteration 4 — JWT secret validation at startup; auth test coverage · 2026-11-08

**Reconciliation first.** Confirmed the hardcoded fallback was already removed in iteration 2
(`f041e06`) and not re-implemented it. Gaps that remained:
- the server still *started* with no `JWT_SECRET`, failing only at the first sign-in;
- `README.md` instructed users to set `JWT_SECRET` to the published fallback value (and a
  SQLite `DATABASE_URL` the schema cannot use);
- `STATE.md` still listed the fallback as open debt, claimed no test suite, and listed two
  completed features (question-set authoring, mobile audit) as next steps.
Also verified: `ExecutionRecord` and `SectionEvaluation` still have no reading/writing code;
`User` has no `isActive` (it exists only on `Branch` and `QuestionSet`).

**Changes.**
- `src/lib/jwt.ts`: exported `assertJwtSecretConfigured()` (the single rule; also rejects
  whitespace-only) and `jwtSecretWarnings()` (< 32 characters → warning only).
- `server.js`: validates `DATABASE_URL` and the JWT secret before listening; exits 1 with
  `[STARTUP ERROR]`; logs `[STARTUP] Required configuration validated.` on success.
- `README.md`: env section and troubleshooting entry corrected.
- `STATE.md`: reconciled (see above).
- `tests/jwt.test.mjs` (17 tests); `npm test` now runs with `--import tsx`.

**Tests executed.**
- Unit: round-trip for ADMIN/LECTURER/STUDENT with 7-day expiry; expired, foreign-secret,
  tampered (STUDENT→ADMIN), `alg: none`, HS512, malformed and empty tokens all rejected;
  missing/empty/whitespace secret → sign throws and verify fails closed; published secret
  refused; short-secret warning; header and cookie extraction.
- HTTP: real password login for all three roles → token verifies and `/api/auth/me` 200;
  role matrix over 5 endpoints × 3 roles; missing/expired/foreign/escalated/garbage tokens →
  401; WebSocket run with an expired token → `UNAUTHORIZED`, program never ran.
- Startup: empty secret → exit 1; published secret → exit 1; configured secret → validated.
- Full suite: **47 pass, 0 fail** (dev server); `npm run build` compiles; **47 pass, 0 fail**
  against the production server; `tsc --noEmit` clean.

**Corrections during the loop.** (1) The startup regression test first failed because the dev
server had replaced the production build in `.next` — a test-setup fault; the test now stops at
the validation log line instead of needing a build. (2) Removed an assertion I had added that
depended on the local `.env` secret length, which would fail on another developer's machine.

**Remaining.** On Vercel the check is per-request, not at boot (no long-lived process).

---

## Iteration 5 — Framework and dependency advisories (S8) · 2026-11-08

**Objective.** Remove known framework vulnerabilities without an unapproved major upgrade.

**Analysis.** `npm audit` listed ~35 Next.js advisories. 14.2.35 is the last 14.2 release;
many advisories are fixed only in 15.5+. Each class was checked for reachability in this
codebase (table in `SECURITY_AUDIT.md` S8). Probes on the production server before changes:
`/_next/image?url=/cbit-logo.png` → **200 image/png**; WebSocket upgrade to an arbitrary path →
**still open after 3 s**.

**Changes.**
- `next` 14.2.10 → 14.2.35 (exact pin); `npm audit fix` without `--force` (6 transitive
  patch bumps, listed in S8).
- `next.config.mjs`: `images: { unoptimized: true }`.
- `server.js`: in production, destroy upgrade sockets for any path other than `/api/ws`.
- `tests/framework-hardening.test.mjs` (4 tests; boots its own production server, skips with
  a reason if no build exists).

**Tests executed.**
- `tsc --noEmit` clean; `npm run build` compiles.
- Production server: `npm test` → **51 pass, 0 fail, 0 skipped**.
- Dev server: `/`, `/login`, `/student`, `/lecturer`, `/admin` → 200; HMR WebSocket
  (`/_next/webpack-hmr`) still opens; `npm test` → **47 pass, 0 fail, 4 skipped** (the
  production-only tests, by design).

**Not done.** No browser screenshot of the pages after disabling image optimisation; the
login HTML was checked to reference `/cbit-logo.png` directly and the file served with 200.

**Remaining.** RSC advisories need Next 15.5+ (owner decision). `dompurify` pinned by Monaco.

---

## Iteration 6 — ExecutionRecord persistence · 2026-11-08

**Objective.** Store every student run server-side and let the evaluator check the student's
Output section against what actually executed. (`ExecutionRecord` existed in the schema with
zero code reading or writing it.)

**Changes.**
- `src/lib/runTranscript.ts` (new, dependency-free): `stripAnsi`, `applyTerminalInput`
  (now per character, so pasted multi-line input is captured), `appendBounded`,
  `findMatchingRun`. `Terminal.tsx` now uses it instead of its own copy.
- `src/lib/executionRecords.ts` (new): `persistExecutionRecord` — 64 KB per field, 200 per
  workspace, never throws.
- `ExecutionController`: per-run capture; one guarded `finalizeRun()` called from every
  ending; `authorizeRun` returns the student's workspace id.
- `GET /api/lecturer/executions` (new).
- `src/components/RunHistory.tsx` (new) + inspector **Runs** tab; tab strip now always shown
  with `role="tab"`/`aria-selected`.
- `tests/execution-records.test.mjs` (11 tests); `tests/helpers.mjs` gained prompt-driven input.

**Tests executed.**
- Records for success / compile failure / manual stop; none for faculty runs or rejected runs;
  API access matrix (owner 200, admin 200, other lecturer 404, student 403, bad id 404, missing
  param 400); retention cap + truncation; DB failure does not throw; pure capture rules.
- Full suite: **58 pass + 4 skipped (dev)**, **62 pass (production)**; `npm run build` compiles;
  `tsc` clean; 0 fixture rows left.
- Browser (system Chrome via playwright-core, real engine runs): **13/13** — match banner and
  badge for an unedited Output, warning for an edited one, input and transcript shown,
  Answer Sheet and Code tabs unaffected, no console errors from the Runs tab, dark theme
  (applied through the account's saved theme and restored afterwards).

**Corrections during the loop.**
1. Test 1 failed once on a cold server: input sent on a fixed 300 ms timer can arrive before
   the prompt, so the echo precedes it in the transcript. Product behaviour is correct (the
   student's terminal shows the same order). Fixed the test, not the code: input is now sent
   when the prompt appears. 3 cold starts → 11/11 each. Same fix applied pre-emptively to the
   stop test.
2. Browser script: three locator/navigation mistakes of mine (sidebar vs `lg:hidden` tab strip;
   "Open Workspace" button; input check). A first "dark theme" pass was **invalid** — the
   screenshot was still light because the app applies the account's saved theme — and was
   redone properly.

**Found, not fixed (pre-existing; logged in STATE.md §3b):** light-theme inspector heading
contrast, near-black inactive tabs, missing favicon, sidebar highlight without a subject.

**Remaining.** Records hold the transcript, not the source that ran. Only the Output section
is compared (not Input).

---

## Iteration 7 — Section-wise evaluation · 2026-11-08

**Objective.** Mark weighted answer-sheet sections individually and roll them up into the
submission total (CLAUDE.md §3), without changing exams that have no weighted sections.
(`SectionEvaluation` existed in the schema with zero code reading or writing it.)

**Pre-existing defects found while observing.**
- `api/lecturer/evaluate` wrote `marks` unvalidated (negative, above maximum, non-numeric).
- The grading panel reopened blank as APPROVED + publish: re-saving an evaluated submission
  could silently approve and publish it.
- No publish control existed in the UI (state variable with no input) although STATE.md
  claimed a publish toggle — every grade was published immediately.
- "Marks (out of 100)" was hardcoded; the "Grading Panel" heading was white on white in light mode.

**Changes.**
- `src/lib/answerSheet.ts`: `gradableSections`, `evaluateSectionMarks`, `validateFlatMarks`.
- `api/lecturer/evaluate`: `sectionMarks` mode (server-computed total, merge with saved marks,
  publish requires completeness, one transaction, no rows for untouched blank sections); flat
  mode validated; generic 500 message.
- `api/lecturer/submissions`: per-section saved evaluation for prefill.
- `api/student/grades`: per-section breakdown (published results only, as before).
- Lecturer grading panel rebuilt on primitives with prefill, section inputs, live total,
  publish checkbox, PENDING status; student results show the breakdown.
- `tests/section-evaluation.test.mjs` (13 tests).

**Tests executed.**
- API/unit: 13/13 first run.
- Full suite: **71 pass + 4 skipped (dev)**; `npm run build` compiles; **75/75 (production)**.
- Browser (Chrome, production build): **23/23** — section inputs and visible labels, progress
  and live total, publish blocked when incomplete, inline range error, partial save stored
  exactly (1 row, no total, unpublished, PENDING), reopen prefill (mark, remark, status,
  publish), completion → 41.5/50 published, flat exam unchanged, student breakdown on desktop
  and at 390 px with no horizontal scroll, heading readable in light theme, no page errors.
  Iteration 6 Runs-tab script re-run: 13/13.

**Corrections during the loop.**
1. Wrote a broken transaction block in the first draft of the route; caught on re-read before
   any test and replaced.
2. Browser run showed blank sections being stored as empty rows → server now skips them
   unless a row exists (so clearing still works). API suite re-run 13/13.
3. **Screenshot review caught what assertions missed:** section labels rendered at zero width
   (the primitive's `w-full` beat `w-20` because `cn()` does not de-conflict classes). Fixed
   with a wrapper and added a label-width assertion.
4. Three test-script issues of mine (ambiguous row locator for two submissions by one student;
   phone drawer navigation; reading the prefilled value before the effect ran).

**Remaining.** `cn()` class conflicts are a latent issue for every primitive (logged in STATE.md).
