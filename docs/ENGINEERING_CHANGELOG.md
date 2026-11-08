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
