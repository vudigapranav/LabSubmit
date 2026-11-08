# SECURITY_AUDIT.md — LabSubmit

**Assessment dates:** 2026-11-08 (iterations 1–10) · **Branch:** `claude/labsubmit-development-y605fv`
**Scope:** the full repository — REST API (28 route files), execution WebSocket, native compiler engine,
frontend, Prisma/PostgreSQL usage, `Dockerfile`, `docker-compose.yml`, dependencies.
**Method:** static review, secret/pattern scanning, `npm audit`, and controlled dynamic tests against a
**local** server + local PostgreSQL, plus a **disposable Linux container** for the execution engine. No
production system was touched; no denial-of-service volumes were used (sizes/counts just over each limit).

Companion documents: `THREAT_MODEL.md` · `API_SECURITY_MATRIX.md` · `COMPILER_SECURITY_REVIEW.md` ·
`SECURITY_REMEDIATION_LOG.md` · `SECURITY_TEST_RESULTS.md`.

**Evidence labels.** *Verified* = reproduced dynamically before the fix and retested after.
*Code-verified* = established by reading code, with the fix covered by a test. *Suspected* = plausible,
not demonstrated. CVSS v3.1 base scores are the assessor's estimates for this deployment.

---

## Final assessment

**NOT READY FOR PRODUCTION** for untrusted students on the current deployment configuration.
**SECURE FOR TESTING** (supervised demonstration with trusted users).

Reason, from evidence: in the configuration the `Dockerfile` currently produces (server as root, no
`EXEC_RUN_UID*`), a student program **read `JWT_SECRET` from `/proc/<server>/environ`** and could
signal the server process (Linux probe P2/P3, `COMPILER_SECURITY_REVIEW.md`). That is a full
authentication bypass. The code fix exists and is verified (per-run uid pool); enabling it is a
deployment change awaiting owner approval. Network egress from student code (S19) remains open in
every configuration until a real sandbox is introduced. See "Release gate" at the end.

---

## Summary

| ID | Sev. | CVSS | Finding | Evidence | Status |
|---|---|---|---|---|---|
| S1 | CRITICAL | 9.9 | Student programs inherited server env (`JWT_SECRET`, `DATABASE_URL`) | Verified | **Fixed** (it.1; Linux P1) |
| S2 | CRITICAL | 9.9 | Path traversal via client filenames | Verified | **Fixed** (it.1) |
| S3 | HIGH | 8.8 | Shell injection in compile command | Verified | **Fixed** (it.1) |
| S4 | CRITICAL | 9.9 | No OS isolation: same uid as server → secret theft via `/proc`, kill server, read other runs | Verified (Linux) | **Fixed in code, not deployed** — needs `EXEC_RUN_UID_RANGE` + root on Railway |
| S19 | HIGH | 7.7 | Unrestricted network egress from student programs | Verified (Linux P6) | **Open** — needs sandbox (approval) |
| S5 | HIGH | 9.1 | Hardcoded fallback JWT secret | Code-verified | **Fixed** (it.2, startup check it.4) |
| S6 | HIGH | 6.5 | Students could list all exam papers via `/api/lecturer/labs` | Verified | **Fixed** (it.2) |
| S13 | HIGH | 7.1 | Exam paper served before start, before Start (timer bypass), and across cohorts | Verified | **Fixed** (it.8) |
| S7 | MEDIUM | 5.3 | Login brute force + account enumeration | Verified | **Fixed** (it.3) |
| S8 | MEDIUM | 7.5 | Vulnerable Next.js / transitive deps | `npm audit` | **Partially fixed** (it.5) — residual needs Next 15.5+ |
| S12 | MEDIUM | 6.5 | File save/rename/delete not scoped to own workspace (IDOR) | Verified | **Fixed** (it.2) |
| S14 | MEDIUM | 6.5 | No size limits on files/answers (storage exhaustion) | Verified | **Fixed** (it.8) |
| S15 | MEDIUM | 6.5 | WebSocket: unlimited parallel runs per user; 100 MB frames | Verified | **Fixed** (it.9) |
| S16 | MEDIUM | 5.3 | Child processes outlive the run | Verified (Linux) | **Fixed** for process group (it.9); `setsid` escape fixed in pool mode (it.10) |
| S18 | MEDIUM | 5.3 | No password policy (1-char passwords accepted) | Verified | **Fixed** (it.8) |
| S23 | MEDIUM | 5.4 | Lecturer could create/move an exam into another lecturer's subject | Verified | **Fixed** (it.10) |
| S9 | LOW | 4.2 | No server-side session revocation (7-day stateless tokens) | Code-verified | **Open** |
| S10 | LOW | 5.3 | Lecturer directory (names, emails) public | Verified | **Fixed** (it.8) |
| S17 | LOW | 4.3 | No anti-framing / security headers | Verified | **Fixed** (it.8) — no script CSP |
| S20 | LOW | 3.1 | Zombie processes accumulate (PID 1 is `node`, which does not reap) | Verified (Linux) | **Open** — `--init`/tini (deploy change) |
| S22 | LOW | 3.5 | Any lecturer can list students of any cohort | Code-verified | **Accepted** (staff directory) |
| S26 | LOW | 5.5 | No `.dockerignore`: local `.env` baked into image layers | Verified | **Fixed** (it.10) |
| S27 | MEDIUM | 6.8 | Deployment guide runs the seed on production: public admin password, and a second run wipes all data | Verified (guard) | **Fixed** (it.10) |
| S11 | INFO | — | 500 responses echoed exception text | Verified (static test) | **Fixed** (it.8) |
| S21 | INFO | — | WebSocket `Origin` not checked | Code-verified | **Accepted** — no ambient credentials |
| S24 | INFO | — | Rate limiter, run slots, uid pool are in-memory, per instance | Design | **Accepted** for one execution host |
| S25 | INFO | — | Token in `localStorage` (XSS would expose it) | Code-verified: no XSS sinks | **Accepted residual** |

---

## Findings

Format per finding: component / files · evidence · attack scenario · impact · remediation · status · retest.

### S1 — Student programs inherited the server environment · CRITICAL (9.9)
- **Component:** execution engine — `PtyService.spawnPty`, `CompilerService` (`exec`).
- **Evidence:** `print(os.environ)` showed `JWT_SECRET`/`DATABASE_URL` (test S1 failed on unfixed code).
- **Scenario:** student prints the secret during any running exam → signs an ADMIN token offline.
- **Impact:** total compromise of accounts, marks and results; direct DB access.
- **Remediation:** allow-listed env built in `sandbox.ts` for compile and run.
- **Status:** Fixed (`2a109ad`). **Retest:** `execution-security` S1 pass; Linux probe P1 `CLEAN` in all modes.

### S2 — Path traversal via filenames · CRITICAL (9.9)
- **Files:** `CompilerService.prepareAndCompile`, `ExecutionController.handleRun`.
- **Evidence:** `../labsubmit_pwn_*.txt` written into `$TMPDIR` by the unfixed engine.
- **Scenario/impact:** overwrite server code or other runs' files → server-side code execution.
- **Remediation:** single-segment allow-list (`sourceFilename.ts`) at the engine *and* REST; resolved-path assertion.
- **Status:** Fixed (`2a109ad`). **Retest:** 2 traversal tests pass; no files written.

### S3 — Shell injection in compilation · HIGH (8.8)
- **Files:** `CompilerService` (`exec(compileCmd)`).
- **Evidence:** filename `x$(touch marker).c` — test failed on unfixed code.
- **Remediation:** `execFile` with argument arrays; filename allow-list.
- **Status:** Fixed. **Retest:** S3 test pass.

### S4 — No OS-level isolation of student code · CRITICAL (9.9)
- **Component:** execution host (`Dockerfile` runs as root; no uid separation by default).
- **Evidence (Linux container, `COMPILER_SECURITY_REVIEW.md`):** same-uid mode — P2 read the parent's
  environ **including `JWT_SECRET`**; P3 could signal the server; P8 wrote `/etc`; P9 read another
  run's files; P7 spawned 300 processes; P11 `setsid` child survived.
- **Scenario:** a student reads the server's environment through `/proc` (the env scrub does not stop
  this) → S1's impact again; or kills the server mid-exam for everyone.
- **Remediation implemented:** `EXEC_RUN_UID_RANGE` per-run uid pool (`sandbox.ts`): P2/P3/P7/P9/P11 all
  blocked in the probe; all four languages verified working. Also ulimits (CPU, file size, memory).
- **Status:** **Fixed in code; NOT active in the current deployment.** Requires the Railway service to run
  the server as root (it does) and set `EXEC_RUN_UID_RANGE=20000-20099`. Owner approval pending.

### S19 — Network egress from student programs · HIGH (7.7)
- **Evidence:** Linux probe P6 — TCP connect to an external address succeeded in every mode.
- **Scenario:** a student program contacts the internet (exfiltrate the paper, fetch solutions), or the
  database host/internal services reachable from the execution container.
- **Remediation (needs approval — architectural):** run student programs in a network namespace with no
  interfaces (nsjail / bubblewrap with `--unshare-net`, or a separate runner container on an
  internal-only network). Cannot be done with `ulimit` or uid changes.
- **Status:** Open.

### S5 — Hardcoded fallback JWT secret · HIGH (9.1)
- **Files:** `src/lib/jwt.ts`, `server.js`, `README.md` (which instructed users to use the public value).
- **Remediation:** no fallback; `assertJwtSecretConfigured()` refuses missing/blank/published values;
  `server.js` exits at startup; HS256 pinned.
- **Status:** Fixed (`f041e06`, `8421569`). **Retest:** 17 tests in `jwt.test.mjs` incl. startup refusal,
  forged-with-fallback → 401, `alg:none`/HS512/tampered/expired → rejected.

### S6 — Exam papers via faculty endpoint · HIGH (6.5)
- **Files:** `api/lecturer/labs` GET allowed STUDENT with no filter.
- **Status:** Fixed. **Retest:** student 403; role matrix test.

### S13 — Exam paper exposure (early / pre-Start / cross-cohort) · HIGH (7.1)
- **Files:** `api/student/workspace` GET and `start_exam`.
- **Evidence:** before the fix, for a published exam a student received the problem statement (a) from
  another branch/year, (b) while UPCOMING, (c) before pressing Start — 4 tests failed.
- **Scenario:** read tomorrow's paper today; or with a per-student duration, read the paper for an hour and
  then start a full-length clock.
- **Remediation:** `examAccess.ts` — cohort rule identical to the student's exam list; paper released only
  once the attempt started (or was submitted); `start_exam` re-checks cohort (fail closed on entry).
- **Status:** Fixed (`078d90a`). **Retest:** 4 API tests; browser 11/11 (plain + question-set exams; gate,
  start, reload; set label never sent).

### S7 — Login brute force and enumeration · MEDIUM (5.3)
- **Status:** Fixed (`5cef040`): one generic error; dummy bcrypt for unknown accounts; 10 failures/account and
  100/address per 15 min → 429. **Retest:** `auth.test.mjs` 7/7. Trade-off: third party can lock an account
  for 15 min.

### S8 — Vulnerable framework/dependencies · MEDIUM (7.5)
- **Status:** Partially fixed (`9c29209`): Next 14.2.35; reachable unpatched surfaces disabled (image
  optimiser; stray WebSocket upgrades). **Residual (`npm audit --omit=dev`, final run):** `next` (RSC DoS /
  cache-poisoning advisories fixed only in 15.5+), `dompurify ≤3.4.16` (pinned by Monaco; modes not used on
  attacker HTML), `postcss` (build-time only). Upgrade to Next 15.5 + React 19 needs approval.

### S12 — File IDOR · MEDIUM (6.5)
- **Evidence:** student A overwrote student B's file by id (HTTP 200). **Status:** Fixed. **Retest:** 3 tests.

### S14 — No request size limits · MEDIUM (6.5)
- **Evidence:** 600 KB file save → 200; 200 KB answer → 200; unlimited file creation.
- **Remediation:** 256 KB per file, 64 KB per answer, 20 files per attempt (413/400); limits shared with the engine.
- **Residual:** the JSON body is parsed before the check (Vercel caps function bodies at 4.5 MB).
- **Status:** Fixed. **Retest:** 3 tests.

### S15 — WebSocket abuse limits · MEDIUM (6.5)
- **Evidence:** 3 parallel runs by one student all started; a 4 MB frame was accepted.
- **Remediation:** max 2 concurrent runs per user (atomic claim); `maxPayload` 2 MB (close 1009).
- **Status:** Fixed (`ad61c08`). **Retest:** 2 tests incl. slot release on disconnect.

### S16 — Processes outliving the run · MEDIUM (5.3)
- **Evidence:** a SIGHUP-immune child survived the run (macOS test failed; Linux probe confirmed).
- **Remediation:** kill the whole process group on cleanup; in pool mode, kill every process of the run's uid
  (catches `setsid` escapees — Linux P11).
- **Status:** Fixed. **Retest:** S16 test pass; Linux P10 killed (all modes), P11 killed (pool mode only).

### S18 — No password policy · MEDIUM (5.3)
- **Evidence:** password `1` accepted on change. **Remediation:** `passwordPolicy.ts` (8 chars–72 bytes) on
  registration, admin create, both resets, self-change. **Status:** Fixed. **Retest:** 2 tests.

### S23 — Exam placement under foreign subjects · MEDIUM (5.4)
- **Evidence:** a lecturer created an exam under another lecturer's subject (row in DB).
- **Remediation:** creation/move requires teaching the subject; exam cohort must match the subject's.
- **Status:** Fixed (`ebcfff5`). Existing data checked: no mismatches. **Retest:** S23 test.

### S27 — Production seeding hazard · MEDIUM (6.8)
- **Files:** `prisma/seed.ts`, `DEPLOYMENT.md` §5.
- **Evidence:** the guide instructs `npm run db:seed` on Railway; the script begins with `deleteMany()` on every
  table and creates `admin@cbit.in` / `admin@123` (public). The guide claimed a second run "may create duplicates".
- **Scenario:** an operator re-runs the documented command after go-live → every submission and mark is deleted;
  or the admin password is never changed → anyone can sign in as admin.
- **Remediation:** in production the seed requires `SEED_ADMIN_PASSWORD` (12+) and refuses a database that has
  users unless `SEED_RESET=yes`; both checks run before any write. Guide corrected. Development unchanged.
- **Status:** Fixed. **Retest:** guard refused without password (unreachable DB); refused with password on a DB
  with users — user count unchanged (6 → 6). Seeded demo users still have the public `password123`.

### S9 — No session revocation · LOW (4.2)
- Tokens are verified by signature only for 7 days; logout is client-side; deleting a user does not
  invalidate a token for routes that do not read the user row. No `User.isActive` exists.
- **Recommendation:** `tokenVersion` column checked in `requireAuth` (requires making `requireAuth` async
  across ~28 routes — deliberate change, deferred). **Status:** Open.

### S10 — Public lecturer directory · LOW · Fixed (ADMIN/LECTURER only; no in-app consumer).
### S17 — Security headers · LOW · Fixed: `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`,
`Referrer-Policy`, `Permissions-Policy`, no `X-Powered-By`. A script-restricting CSP was **not** added
(Monaco CDN + Next inline scripts) — residual XSS defence relies on React escaping.
### S20 — Zombie accumulation · LOW · Open: killed children are reparented to PID 1 (`node`) and never reaped
(Linux P10). Fix: run with an init (`docker run --init` / `tini` in the Dockerfile) — deploy change.
### S22 — Cross-cohort student listing for lecturers · LOW · Accepted (staff can see the student directory).
### S26 — Secrets in Docker build context · LOW (5.5) · Fixed: `.dockerignore`; verified context had `.env`
(key names `DATABASE_URL`, `JWT_SECRET`) before and not after.
### S11 — Exception text in responses · INFO · Fixed: 43 handlers; static test asserts none remain.
### S21 — WebSocket Origin · INFO · Accepted: the token travels inside the message, never as a cookie, so a
foreign page cannot ride a victim's session. Railway and Vercel are different origins by design.
### S24 — Per-instance in-memory limits · INFO · Accepted for a single execution host.
### S25 — Token in `localStorage` · INFO · Accepted residual; no `dangerouslySetInnerHTML`, `eval`, `new Function`
or raw SQL anywhere in `src/` (grep).

---

## Verified as sound

- Every non-public route calls `requireAuth` with an explicit role list; 20 GET endpoints × 4 identities
  (admin, lecturer, student, none) returned the expected 200/401/403 (`API_SECURITY_MATRIX.md`).
- **No bcrypt hash or `password` key** appears in any GET response for any role (raw-response scan).
- Passwords: bcrypt cost 10; never logged (grep for logging of request bodies/passwords: none).
- No raw SQL; Prisma parameterises all queries. No cookies set → CSRF not applicable.
- Question-set identity never reaches students (existing tests + browser check: set label absent).
- Deadlines, submission state, violation severity and assignment are decided server-side (existing design,
  re-exercised by the suite).

## Release gate (section 15 of the brief)

| Check | Result |
|---|---|
| No hardcoded production secrets | ✅ (secret scan: only the deliberately refused legacy value) |
| No insecure JWT fallback | ✅ |
| Secure password hashing | ✅ bcrypt; policy enforced |
| Server-side role authorisation, ownership checks | ✅ tested |
| API validation | ✅ for the paths tested; sizes bounded |
| Deadline enforcement, protected submissions/questions | ✅ |
| **Secure compiler isolation** | ❌ **in the current deployment** (S4 not enabled; S19 open) |
| Execution resource limits | ✅ CPU/file/memory; process count only in pool mode |
| Secure WebSocket | ✅ auth per run, payload and concurrency limits |
| No unresolved critical/high | ❌ S4 (until enabled), S19, S8 residual |
| Dependencies checked | ✅ residual documented |
| Production configuration reviewed | ✅ findings S4, S20, S26 |
| Regression tests passing | ✅ 91 automated + 47 browser checks |

**The compiler is not safe for untrusted execution in the current deployment.** With
`EXEC_RUN_UID_RANGE` enabled it no longer exposes secrets or other students' work, but programs can still
reach the network.
