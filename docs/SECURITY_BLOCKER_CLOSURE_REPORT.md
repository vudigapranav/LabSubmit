# SECURITY_BLOCKER_CLOSURE_REPORT.md — INTERIM (milestone in progress)

**Status: 2 of 10 items addressed; milestone NOT complete. Do not start the Live Exam Control Room yet.**
Last updated 2026-11-08. Nothing pushed, deployed, or changed in production.

| # | Blocker | Status | Evidence so far |
|---|---|---|---|
| 1 | `EXEC_RUN_UID_RANGE` against the real execution service | 🟡 Engine-level verified on Linux (aarch64): CompilerService/PtyService/CleanupService with the pool — P2/P3/P7/P9/P11 blocked; C/C++/Java/Python OK; uid reuse OK. **Not yet run through the full `server.js` + WebSocket in the real Docker image.** | `COMPILER_SECURITY_REVIEW.md` |
| 2 | Network isolation | ✅ implemented (opt-in), 🟡 verified on aarch64 only | see below |
| 3 | Snapshot SHA-256 review | ❌ not started (planned: HMAC signature with a key outside the DB; block exam deletion that cascades hand-ins) | |
| 4 | Audit chain vs privileged DB modification | ❌ not started (planned: HMAC per row, append-only triggers, anchoring) | |
| 5 | Autosave conflicts / multi-session / recovery / deadline boundary | 🟡 conflicts, offline recovery, stale drafts verified (iteration 14); deadline-boundary and two-browser tests not written | |
| 6 | Session recovery cannot extend deadlines / reopen submissions | ❌ review not written (code: `startedAt` only set when null; submitted attempts refuse actions) | |
| 7 | RBAC / IDOR review | 🟡 existing matrix + tests; cross-owner IDOR matrix test not written | `API_SECURITY_MATRIX.md` |
| 8 | Migration plan | ❌ not written (schema changes so far are additive: `SubmissionSnapshot`, `AuditEvent`) | |
| 9 | Full regression | ✅ `npm test` 113 (109 pass + 4 prod-only skips, dev) after these changes | |
| 10 | Docs with evidence | 🟡 this interim report | |

## Blocker 2 — network isolation (done this session)

**Root cause.** Student programs could open any socket (Linux probe P6/P16). Network namespaces and
iptables need capabilities a PaaS container does not have.

**Implementation.** `src/lib/execution/sandbox-launcher.c`: installs an unprivileged seccomp-BPF filter
(no_new_privs) then execs the program; inherited by all children. Refuses `socket()` except AF_UNIX,
io_uring (would bypass the socket filter), ptrace, process_vm_*, mount/umount2/pivot_root/chroot,
unshare/setns, bpf, perf_event_open, userfaultfd, keyctl/add_key/request_key, kexec/module calls,
reboot, swapon/off, acct; kills foreign-arch and x32 syscalls. Fails closed if the filter cannot be
installed. Wired through `sandbox.ts` (`EXEC_SANDBOX_LAUNCHER`), with `EXEC_REQUIRE_SANDBOX=true`
refusing runs when the launcher or per-run uid pool is missing. Startup logs the isolation in force.
Dockerfile builds the launcher and runs `tini` as PID 1 (reaps zombies, S20).

**Evidence (disposable container, aarch64, real engine code):** with launcher + pool — TCP connect and
UDP socket → PermissionError; ptrace, io_uring, unshare → blocked; AF_UNIX socketpair still works;
C/C++/Java/Python with stdin all exit 0. x86_64 build compiles cleanly (`-Wall`).

**Remaining risk.** Not executed on x86_64 (Railway's architecture) — emulation on this Mac would not
give a meaningful seccomp result. Not yet tested inside the full production image.

## Exact manual actions (when ready to deploy — none done)

1. Deploy the image built from this branch (it contains the launcher and tini).
2. In the deployed container, self-test the filter on x86_64:
   `/usr/local/bin/labsubmit-sandbox python3 -c "import socket; socket.socket()"` → must print `PermissionError`.
3. Set Railway variables: `EXEC_RUN_UID_RANGE=20000-20099`,
   `EXEC_SANDBOX_LAUNCHER=/usr/local/bin/labsubmit-sandbox`, `EXEC_REQUIRE_SANDBOX=true`.
4. Check the startup log line: `Execution isolation: identity=per-run uid 20000-20099; network/syscall filter=seccomp launcher; required=true`.
5. `npx prisma db push` for the two additive tables — only after the migration plan (item 8) is written and a backup is taken.
