# SECURITY_AUDIT.md — LabSubmit

**Audit date:** 2026-11-08 · **Branch:** `claude/labsubmit-development-y605fv` · **Base commit:** `85240d1`

Findings are from reading the code, not from scanning tools, unless stated otherwise.
No secret values are reproduced here. Status is updated as fixes land; the fix commit and
the verification that proved it are recorded in `ENGINEERING_CHANGELOG.md`.

Severity scale: CRITICAL · HIGH · MEDIUM · LOW · INFORMATIONAL.

---

## Summary

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| S1 | CRITICAL | Student programs inherit the server environment (`JWT_SECRET`, `DATABASE_URL`) | **Fixed — iteration 1** (verified on macOS; see S4 for Linux caveat) |
| S2 | CRITICAL | Path traversal: client-supplied filenames written outside the execution temp dir | **Fixed — iteration 1** (verified) |
| S3 | HIGH | Shell command injection through filenames in the compile command | **Fixed — iteration 1** (verified) |
| S4 | CRITICAL | No OS-level isolation of student code (same uid as server, network, no memory/process limits) | **Partially mitigated — iteration 1.** Release blocker for unsupervised hosting until uid drop is enabled on Railway |
| S5 | HIGH | Hardcoded fallback JWT signing secret in `src/lib/jwt.ts` | **Fixed — iteration 2** (verified) |
| S6 | HIGH | Students can read every exam paper (incl. drafts, upcoming) via `GET /api/lecturer/labs` | **Fixed — iteration 2** (verified) |
| S7 | MEDIUM | Login: no rate limiting; distinct error messages enable account enumeration | **Fixed — iteration 3** (verified) |
| S8 | MEDIUM | `next@14.2.10` has published critical/high advisories | **Partially fixed — iteration 5.** Patched to 14.2.35; reachable unpatched surfaces disabled; residual advisories need Next 15.5+ (owner decision) |
| S9 | LOW | 7-day tokens with no server-side revocation; deactivating/deleting a user does not end an existing session | Open — needs verification |
| S10 | LOW | `GET /api/auth/lecturers-available` is unauthenticated and returns lecturer names and emails | Open |
| S12 | MEDIUM | `save_file` / `rename_file` / `delete_file` act on `fileId` without checking it belongs to the caller's workspace (IDOR; ids are unguessable, hence MEDIUM) | **Fixed — iteration 2** (verified) |
| S11 | INFO | Many 500 handlers echo `error.message` to the client (may leak Prisma internals) | Open |

---

## S1 — Student programs inherit the server environment · CRITICAL

**Files:** `src/lib/execution/PtyService.ts` (`env: { ...process.env, ... }`),
`src/lib/execution/CompilerService.ts` (`exec` with default env).

**Evidence.** The runtime PTY was spawned with a copy of the full server environment. On the
execution host that environment contains `JWT_SECRET` and `DATABASE_URL` (see `.env` key
names and `DEPLOYMENT.md`).

**Impact.** Any student with a running exam could run `print(__import__('os').environ)` and
read the JWT signing secret, then mint a token for any user including ADMIN — full
compromise of every account, every mark and every result. `DATABASE_URL` gives direct
database write access. This defeats every other control in the platform.

**Remediation (iteration 1).** Compile and run processes receive a minimal allow-listed
environment (`PATH`, `HOME`=temp dir, `LANG`, `TERM`, `JAVA_HOME`, `PYTHONUNBUFFERED`),
built in one place (`src/lib/execution/sandbox.ts`). See S4 for why this alone is not
sufficient on Linux.

## S2 — Path traversal via filenames · CRITICAL

**Files:** `src/lib/execution/CompilerService.ts`, `src/lib/execution/ExecutionController.ts`.

**Evidence.** The WebSocket `run` message carries `filename` and `files[].filename` directly
from the client (not from the database). They were passed to `path.join(tempDir, filename)`
and written, with `mkdir -p` on the parent.

**Impact.** A filename such as `../../app/server.js` writes arbitrary content anywhere the
server user can write — server code, build output, other students' temp dirs.

**Remediation (iteration 1).** Every filename is validated as a single path segment against a
strict allow-list (`isSafeSourceFilename`) before any filesystem access; a request with any
unsafe name is rejected outright, and the resolved path is additionally asserted to sit
inside the temp dir.

## S3 — Shell injection in compile command · HIGH

**File:** `src/lib/execution/CompilerService.ts` (`exec(compileCmd)` with `"${path}"` interpolation).

**Impact.** A filename containing `"` or `$(...)` executed arbitrary shell as the server
user during compilation — outside even the runtime timeout guard.

**Remediation (iteration 1).** Compilation uses `execFile` with argument arrays (no shell). The C++
two-step build is two `execFile` calls. S2's filename allow-list also excludes shell
metacharacters as defence in depth.

## S4 — No OS-level isolation · CRITICAL (partially mitigated)

**Files:** `src/lib/execution/*`, `Dockerfile`.

**Evidence.** Student code runs as the same OS user as the Node server, with network
access, and with no memory, process-count or file-size limits. `RuntimeSandbox` only
enforces a wall-clock timeout and an output byte cap.

**Impact.**
- On Linux, a same-uid process can read `/proc/<server-pid>/environ` — so S1's env scrub
  does **not** fully protect secrets unless the program runs under a different uid.
- A program can signal the server process (`kill(getppid(), 9)`) — denial of service for
  every concurrent exam.
- Fork bombs / memory exhaustion can take down the host.
- Unrestricted network egress.

**Mitigation (iteration 1).** *Verification status:* CPU/file-size limits and env scrub verified on macOS
by `tests/execution-security.test.mjs`. The `ulimit -v` memory cap, the `/proc` test and the uid drop are
**Linux-only and not yet executed on Linux** (Docker was unavailable during iteration 1) — verify in the
Railway image before relying on them.
- Per-process resource limits applied through a `ulimit` wrapper: CPU seconds, max file
  size, and virtual memory for native/Python programs (Java uses `-Xmx` instead because the
  JVM reserves large virtual address space).
- Optional privilege drop: when `EXEC_RUN_UID`/`EXEC_RUN_GID` are set and the server runs as
  root, compile and run processes execute as that unprivileged uid, the temp dir is
  chowned to it, and `/proc/<server>/environ` is no longer readable by student code.

**Still required (release blocker for any hosting beyond a supervised demo).**
- Enable the privilege drop on the Railway image (add an unprivileged user in the
  `Dockerfile` and set `EXEC_RUN_UID/GID`). This changes production deployment and is
  pending owner approval.
- Network isolation and a process-count limit need a real sandbox (nsjail / bubblewrap /
  per-run container). Not achievable with `ulimit` alone without risking the server's own
  process budget.

## S5 — Hardcoded fallback JWT secret · HIGH

**File:** `src/lib/jwt.ts`.

**Impact.** If `JWT_SECRET` is ever unset on either host, tokens are signed with a string
that is in the public repository; anyone can forge an ADMIN token.

**Remediation (iteration 2).** No fallback. A missing secret, or one equal to the historical
fallback, throws on first use (fail closed). Verification pins `algorithms: ['HS256']`.
**Startup validation (iteration 4).** The rule moved into `assertJwtSecretConfigured()` in
`jwt.ts`, and `server.js` calls it (and checks `DATABASE_URL`) before listening, exiting with
`[STARTUP ERROR]` on failure — previously the host started normally and failed only at the
first sign-in. Vercel does not run `server.js`; there the same rule fails closed on every
sign/verify. Secrets under 32 characters log a warning but are accepted so existing
deployments are not locked out. `README.md` had instructed users to set `JWT_SECRET` to the
published value; corrected.
**Operational note:** any deployment that was silently relying on the fallback will stop
issuing/accepting tokens until `JWT_SECRET` is set — that is intended.

## S6 — Students can read all exam papers · HIGH

**File:** `src/app/api/lecturer/labs/route.ts` (`GET` allowed `STUDENT`, no filter).

**Impact.** A student token returned every exam — drafts, upcoming papers, other
branches — with full `problemStatement`, bypassing exam timing, device withholding and
question-set confidentiality.

**Remediation (iteration 2).** `STUDENT` removed from the allowed roles. No student UI used the
endpoint (verified by grep); students use `/api/student/labs` and `/api/student/workspace`,
which are built from what a student may know.

## S7 — Login brute force and enumeration · MEDIUM

**File:** `src/app/api/auth/login/route.ts`.

**Impact.** Unlimited password guessing; "user not found" vs "Invalid password" (and the
role-tab messages before the password check) confirm which roll numbers/emails exist.

**Remediation (iteration 3).** One generic credential error for unknown user and wrong password;
unknown accounts are compared against a dummy bcrypt hash so timing matches a wrong password;
role-tab mismatch only reported *after* a correct password; in-memory per-identifier and
per-IP failure limiter (`src/lib/rateLimit.ts`: 10 failures/account and 100/address per 15 min) returning
429 with `Retry-After`; a locked account is refused even with the correct password.
Accepted trade-off: someone knowing a roll number can lock that account for up to 15 minutes.
Limitation: in-memory, so per-instance on Vercel — raises cost of guessing, not a global
guarantee.

## S8 — Vulnerable framework and dependencies · MEDIUM (partially fixed)

**Iteration 5.** `next` 14.2.10 → **14.2.35** (last 14.2 release), clearing every advisory fixed
within the 14.2 line, including the critical middleware authorisation bypass. `npm audit fix`
(no `--force`) moved six transitive packages within range: dompurify 3.4.8→3.4.15,
monaco-editor 0.56→0.57, nanoid 3.3.16→3.3.20, postcss 8.5.22→8.5.32,
postcss-selector-parser 6.1.4→6.1.5, source-map-js 1.2.1→1.2.2.

The 14.x line is end-of-life: many advisories (three critical RCEs among them) are fixed
**only in 15.5+**. Each was checked against this codebase:

| Advisory class | Exposure here | Action |
|---|---|---|
| Middleware/proxy bypass, i18n bypass | None — no `middleware.ts`, no Pages Router | — |
| Server Actions DoS/SSRF/disclosure | None — no `'use server'` in `src/` | — |
| Rewrites SSRF / request smuggling | None — no rewrites configured | — |
| Image Optimization RCE (AVIF/SVG), DoS, cache growth | **Was reachable** (`/_next/image` returned 200) | **Disabled** via `images.unoptimized` — only a local logo is used |
| WebSocket-upgrade SSRF on custom servers | **Plausible** — custom `server.js` left non-`/api/ws` upgrades open indefinitely | **Closed** in production (dev keeps HMR) |
| RSC Denial of Service; RSC cache poisoning; CSP-nonce XSS | Inherent to App Router | **Residual** — needs Next 15.5+ |

**Residual.** RSC DoS / cache-poisoning advisories remain until a major upgrade (Next 15.5+
requires React 19 for the App Router — an architectural change awaiting owner approval).
`dompurify ≤3.4.16` remains because Monaco pins it; its advisories concern `IN_PLACE`, hook
and `SAFE_FOR_TEMPLATES` modes applied to attacker HTML, and Monaco only sanitises markdown it
generates — low exploitability. `postcss` remaining under `next/node_modules` is build-time only.

## S9 — No session revocation · LOW (needs verification)

Tokens live 7 days and are verified by signature only. Deleting a user does make DB lookups
fail, but routes that trust the token payload without a DB lookup would still act for it.
Needs a per-route check.

## S10 — Unauthenticated lecturer directory · LOW

`/api/auth/lecturers-available` returns names and emails to anyone. Check the registration
UI's actual need and reduce to names/ids or require auth.

## S11 — Error messages echoed to clients · INFO

`catch (error: any) { ... error.message ...}` across routes. Replace with a generic message
and server-side logging.

---

## Things verified as sound

- Every API route under `src/app/api/{admin,lecturer,student}` calls `requireAuth` with an
  explicit role list; role checks are server-side.
- Lecturer ownership (`lab.lecturerId === session.userId`) is enforced in `evaluate`,
  `submissions`, `violations`, `question-sets`, `assignments`, `sections` and in
  `ExecutionController.authorizeRun()`.
- Passwords are hashed with bcrypt.
- Student exam payloads are built from an allow-list (`toStudentPaper()`), and question-set
  identity is stripped server-side (see STATE.md for the verification performed).
- Violation severity is assigned server-side.
