# SECURITY_BLOCKER_CLOSURE_REPORT.md

**Milestone status: all 10 items closed in code and verified** — locally, in a disposable Linux
container, and in a **staging environment built from the production `Dockerfile`** with its own
PostgreSQL. **Nothing is deployed:** production remains exposed until the manual actions at the end
are performed. Date: 2026-11-08. No push, no deploy, no production variables or data touched.

Staging = `labsubmit-staging:local` (this branch's `Dockerfile`, aarch64) + `postgres:16-alpine`, run
with `NODE_ENV=production`, `EXEC_RUN_UID_RANGE=20000-20099`,
`EXEC_SANDBOX_LAUNCHER=/usr/local/bin/labsubmit-sandbox`, `EXEC_REQUIRE_SANDBOX=true`, `INTEGRITY_KEY`.

| # | Blocker | Status |
|---|---|---|
| 1 | Per-run uid pool through the real execution service | ✅ verified in staging |
| 2 | Network isolation of student programs | ✅ verified in staging (aarch64) |
| 3 | Submission snapshot integrity | ✅ signed + DB-immutable; verified |
| 4 | Audit chain vs privileged DB modification | ✅ signed + append-only; verified |
| 5 | Autosave conflicts, multi-session, recovery, deadline boundary | ✅ verified |
| 6 | Session recovery cannot extend deadlines / reopen hand-ins | ✅ verified (no code change needed) |
| 7 | RBAC / IDOR | ✅ cross-owner matrix verified |
| 8 | Safe migration plan | ✅ rehearsed on an old-schema DB; not run on production |
| 9 | Full regression + missing security tests | ✅ 131/131 executed on staging; 128 + 7 skips locally |
| 10 | Documentation with evidence | ✅ this report + updated docs |

---

## 1. `EXEC_RUN_UID_RANGE` against the real execution service

**Root cause.** Earlier verification drove the engine classes directly, not the deployed path.
**Implementation.** No change needed to the pool; `tests/staging-isolation.test.mjs` added.
**Evidence (staging, through WebSocket → `server.js` → `ExecutionController`):** student program runs
as uid 20000–20099; `/proc/<parent>/environ` → PermissionError; signalling the server →
PermissionError; secrets absent from its env; two concurrent students → different uids; C and Java
run. After the full suite: **0 processes left under pooled uids, 0 zombies**.
**Remaining risk.** Pool exhaustion refuses runs (`HOST_BUSY`) above 100 concurrent runs.

## 2. Network isolation

**Root cause.** Student programs could open any socket. PaaS containers lack the capabilities for
network namespaces or iptables.
**Implementation.** `src/lib/execution/sandbox-launcher.c` installs an unprivileged seccomp-BPF filter
then execs the program: only AF_UNIX sockets; io_uring, ptrace, process_vm_*, mount/umount2/
pivot_root/chroot, unshare/setns, bpf, perf_event_open, userfaultfd, keyctl, module and kexec calls,
reboot, swap, acct refused; foreign-arch/x32 syscalls kill the process; fails closed. Built into the
image; enabled by `EXEC_SANDBOX_LAUNCHER`; `EXEC_REQUIRE_SANDBOX=true` refuses runs without it.
**Evidence.** Container probes: TCP connect and UDP socket → PermissionError; ptrace, io_uring,
unshare blocked; AF_UNIX works; C/C++/Java/Python with stdin exit 0. Staging: same through the full
path; image self-test `labsubmit-sandbox python3 -c "import socket; socket.socket()"` → PermissionError.
**Remaining risk.** Verified on **aarch64 only**; Railway is x86_64 (the x86_64 build compiles cleanly
with `-Wall` but was not executed — emulation here would not give a meaningful seccomp result).
Manual action 3 closes this. Not a full VM boundary: kernel exploits remain out of scope.

## 3. Submission snapshot integrity

**Root cause.** A SHA-256 beside the data can be recomputed by anyone with DB write access; deleting
an exam cascaded away every hand-in.
**Implementation.** Snapshot signature = HMAC-SHA256(`INTEGRITY_KEY`, hash); with a key configured, an
unsigned snapshot counts as stripped; trigger refuses `UPDATE` on `SubmissionSnapshot`; lecturers
cannot delete an exam with hand-ins (admins can, audited with the count).
**Evidence (`tests/integrity-hardening.test.mjs`).** DB refuses snapshot UPDATE; with the trigger
disabled, forged content + recomputed hash → `hashValid: true, signature: invalid, verified: false`;
signature stripped → `unsigned, verified: false`; restored → verified. Lecturer delete → 409, hand-in kept.
**Remaining risk.** Someone with both DB access **and** the server environment can forge — that is a
full server compromise. Snapshots still cascade if an admin deletes a student or exam.

## 4. Audit chain vs privileged modification

**Root cause.** A DB owner could rewrite the chain from any row onward with recomputed hashes.
**Implementation.** Per-row HMAC signature; verification fails on an invalid signature, on an unsigned
row after signing began, and on an unsigned newest row while a key is configured (catches stripping
every signature); triggers refuse `UPDATE`/`DELETE` on `AuditEvent` (`prisma/sql/001_append_only.sql`).
**Evidence.** DB refuses UPDATE and DELETE; with the trigger disabled, editing a row and recomputing
every later hash and link is detected **at that row** by signature; stripping signatures detected;
restored chain verifies. Live dev chain: 534 rows (94 signed) verify.
**Remaining risk.** A DB owner can still disable triggers (signatures catch the edit). Off-site
anchoring of the latest hash is documented but not automated. Missing `INTEGRITY_KEY` → unsigned
rows (startup warns).

## 5. Autosave / sessions / deadline boundary

**Evidence.** `tests/session-deadline.test.mjs` (7) and `tests/autosave.test.mjs` (2), browser
autosave 10/10 (iteration 14): save before the deadline accepted, after refused with auto-submit of the
pre-deadline content (`TIMEOUT`, on time); a stale second session's save → 409, newer content kept;
offline → crash → recovered; stale drafts never restored.
**Remaining risk.** Edits made in the last ~1.5 s before the deadline can be lost (debounce); a save
arriving after the deadline is refused by design.

## 6. Session recovery cannot extend deadlines or reopen hand-ins

**Root cause (review).** Confirmed by code and test, no change needed: `startedAt` is set once by the
server; the deadline is `min(endTime, startedAt + duration)`; client timestamps are ignored.
**Evidence.** Re-start with a new session id and a smuggled `startedAt` → same `startedAt` and deadline;
second session flagged by heartbeat; submitted attempt: `start_exam` 403, save/create 403, WebSocket
run `ALREADY_SUBMITTED`; a late hand-in with a forged `onTime` → `onTime: false`.
**Product note (decision for owner, not a vulnerability).** "Needs correction" after the deadline
reopens the attempt but the deadline still blocks edits, so the student cannot actually correct
anything. Safe, but probably not what a lecturer expects — an explicit, audited extension feature
would be needed.

## 7. RBAC / IDOR

**Evidence.** `tests/idor-matrix.test.mjs` (5): lecturer B refused (403/404) on every object endpoint of
lecturer A's exam — question sets (read/create/update/delete), assignments (read/generate/reassign),
exam edit/delete, grading, run history — with no change in the DB and nothing leaked from filtered
lists; student S2 refused on S1's files and faculty/admin routes; owner access unaffected. Plus the
existing role matrix, GET leak scan (no password hashes), cohort and subject-placement tests.
**Remaining risk.** `lecturer/students` lists any cohort (S22, accepted); no session revocation (S9).

## 8. Migration plan

See `DB_MIGRATION_PLAN.md`. Diff is additive (2 tables, indexes, 1 FK from a new table). Rehearsed on
an old-schema DB with a graded submission: no data-loss warning, row counts identical, legacy
submission still served, new audit rows signed; rollback by backup restore rehearsed.

## 9. Regression

| Run | Result |
|---|---|
| Staging (production image, isolation required) | **131 pass, 0 fail**, 4 skipped (framework tests that boot a local server; their checks were run directly on staging: optimiser 404, `X-Frame-Options: DENY`, stray upgrade closed) |
| Local dev | 128 pass, 0 fail, 7 skipped (4 production-only, 3 staging-only) |

**Found by staging:** (a) a fresh build of the existing `Dockerfile` **crashed at start** —
Prisma assumed OpenSSL 1.1, current Alpine has 3 → fixed (`openssl` added); (b) 7 tests depended on a
lab that existed only in the dev DB → helper now creates its own fixture.
Host-dependent assertions (file existence in the host `$TMPDIR`, host PIDs) are meaningful only
against a local server; on staging those properties were checked by the container probes instead.

---

## Remaining risks (summary)

1. **Production is unprotected until the manual actions below are done.**
2. Seccomp verified on aarch64, not yet on x86_64 (manual action 3).
3. Kernel-level escapes are out of scope for seccomp + uid isolation (a VM-based sandbox would be the next step).
4. No session revocation (S9); roll-number squatting at registration (S28) — design decisions.
5. Residual Next.js advisories need the 15.5 major upgrade (S8).

## Exact manual actions (owner — none performed)

1. Back up the production database (`pg_dump -Fc`), off-host.
2. Generate `INTEGRITY_KEY` (`openssl rand -hex 32`); set it on **Vercel and Railway**; keep a copy in a password manager.
3. Deploy the image from this branch. In the Railway shell run the x86_64 self-test:
   `/usr/local/bin/labsubmit-sandbox python3 -c "import socket; socket.socket()"` → must end with `PermissionError`.
   If it does not, **stop** and do not enable `EXEC_REQUIRE_SANDBOX`.
4. Set on Railway: `EXEC_RUN_UID_RANGE=20000-20099`,
   `EXEC_SANDBOX_LAUNCHER=/usr/local/bin/labsubmit-sandbox`, `EXEC_REQUIRE_SANDBOX=true`. Redeploy.
5. Confirm the log line: `Execution isolation: identity=per-run uid 20000-20099; network/syscall filter=seccomp launcher; required=true`.
6. Schema: `npx prisma db push` (stop on any data-loss warning), then `npm run db:protect`.
7. Verify: admin `GET /api/admin/audit?verify=1` → `ok: true`; one test submission shows
   "integrity verified" in the inspector; a test program cannot open a socket.
8. Optional hardening: run the app as a DB role that does not own `AuditEvent`/`SubmissionSnapshot`.

Once these are done and verified, the Live Exam Control Room milestone can begin.
