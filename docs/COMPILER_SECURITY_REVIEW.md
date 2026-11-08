# COMPILER_SECURITY_REVIEW.md — LabSubmit execution engine

**Verdict: safe for untrusted student code when configured as in `SECURITY_BLOCKER_CLOSURE_REPORT.md`
(per-run uid pool + seccomp launcher + `EXEC_REQUIRE_SANDBOX=true`) — verified in staging on the
production image. The CURRENT deployment is not configured that way and remains unsafe until the
manual actions are done.** Not a VM boundary: kernel exploits are out of scope.

Date: 2026-11-08. Code: `src/lib/execution/*`, `server.js`, `Dockerfile`.

## 1. How code runs

`Terminal` (browser) → WebSocket `/api/ws` → `ExecutionController.handleRun`:

1. Validate: filename rule (single path segment, `[A-Za-z0-9_.-]`, no `..`), ≤20 files, ≤1 MB source,
   frame ≤2 MB (`maxPayload`).
2. Authorise per run (`authorizeRun`): JWT → lab exists → lecturer owns it, or student: device eligible,
   own workspace, not submitted, exam RUNNING, before deadline, language allowed.
3. Claim a run slot (≤2 per user) and an OS identity (`acquireRunIdentity`) — synchronously.
4. `CompilerService`: write files inside a fresh temp dir (resolved-path check), compile with `execFile`
   (no shell) under a `/bin/sh` wrapper that sets `umask 077` and `ulimit`s, as the run's uid.
5. `PtyService`: spawn the program under the same wrapper, minimal environment, as the run's uid.
6. `RuntimeSandbox`: 60 s wall clock, 5 MB output cap.
7. `CleanupService`: kill the process group; in pool mode kill every process of the uid and its `/tmp`
   leftovers; delete the temp dir; release the uid.

Languages: C (gcc), C++17 (g++), Java 17 (javac/java, `-Xmx256m`), Python 3.

## 2. Controls and limits

| Control | Mechanism | Applies |
|---|---|---|
| Environment | allow-list: `PATH`, `HOME`/`TMPDIR`=run dir, `LANG`, `LC_ALL`, `TERM`, `JAVA_HOME`, Python flags | always |
| CPU time | `ulimit -t 30` | always (compile and run) |
| File size | `ulimit -f 40960` blocks | always |
| Memory | `ulimit -v 512 MiB` (C/C++/Python); `-Xmx256m` (Java) | Linux (macOS ignores `-v`) |
| Wall clock / output | 60 s / 5 MB | always |
| Process count | `ulimit -u 128` | **pool mode only** (shared-uid `RLIMIT_NPROC` would be shared by everyone) |
| Identity | `EXEC_RUN_UID_RANGE` per-run uid / `EXEC_RUN_UID` shared uid / none | needs server as root |
| File privacy | `umask 077`; run dir `0700` owned by the run's uid | always / when a uid is set |
| Orphans | kill process group; in pool mode kill all processes of the uid | always / pool |
| Concurrency | ≤2 runs per user; pool size bounds host-wide runs | always / pool |
| Network | **none** | — |

## 3. Probe results (disposable Linux container)

Image: `node:20-alpine` + build-base, python3, procps (+ OpenJDK 17 for the language run), running the
**real engine code** mounted read-only, as root (like the `Dockerfile`), with fake `JWT_SECRET` /
`DATABASE_URL`. Each probe is a harmless program; `P7` is bounded to 300 sleepers.

| Probe | No uid (current Dockerfile) | `EXEC_RUN_UID` (shared) | `EXEC_RUN_UID_RANGE` (per run) |
|---|---|---|---|
| P1 secrets in own env | CLEAN | CLEAN | CLEAN |
| P2 read server env via `/proc/<ppid>/environ` | **READ — contained `JWT_SECRET`** | denied | denied |
| P3 signal the server (`kill(ppid, 0)`) | **allowed** | denied | denied |
| P4 allocate 1 GiB | blocked (MemoryError) | blocked | blocked |
| P5 write 100 MB file | blocked | blocked | blocked |
| P6 TCP connect to an external address | **reachable** | **reachable** | **reachable** |
| P7 spawn 300 processes | **300** | **300** | limited at 127 |
| P8 write `/etc`, `/tmp` | **both** | `/tmp` only | `/tmp` only (removed at cleanup) |
| P9 read another live run's files | **readable** | **readable** | not readable |
| P10 SIGHUP-immune child after cleanup | killed (zombie) | killed (zombie) | killed (zombie) |
| P11 `setsid` child after cleanup | **alive** | **alive** | killed (zombie) |

Language regression in pool mode (each run its own uid, stdin via the PTY): C `sq=49`, C++ `tw=42`,
Java `j=42`, Python `cube 27` — all exit 0. Uid reuse across 5 sequential runs: `20000` every time.

"zombie" = killed but not reaped, because PID 1 in the container is `node` (S20; fix with `--init`).

## 4. Findings tied to the engine

S1, S2, S3 fixed · S4 fixed in code, not deployed · S15, S16 fixed · S19 (network) open · S20 open.
Details in `SECURITY_AUDIT.md`.

## 5. Things checked and found sound

- **Command/shell injection:** no shell anywhere in compile or run; arguments are arrays; the wrapper
  passes the program as `"$@"`.
- **Path traversal / symlinks:** names are single segments validated before any write; the server writes
  only files it names itself. A student program can create symlinks inside its own dir at run time, but
  cleanup uses `fs.rm` (does not follow symlinks out of the tree) and the program already runs with its
  own permissions, so a symlink gains it nothing.
- **Cross-user output:** one `ExecutionController` per socket owns one session; output goes only to that
  socket. There is no shared channel to subscribe to.
- **Credentials:** there are no third-party compiler credentials; the risk was the reverse (S1).
- **Cleanup races:** run-slot and uid are claimed synchronously; a late `onExit` cannot finalize a newer
  run (session-id guard, iteration 6).

## 6. Required to make the engine safe for untrusted students

**Approve and deploy (no code change):**
1. Railway variable `EXEC_RUN_UID_RANGE=20000-20099` (server already runs as root in the image).
2. Run with an init process (`docker run --init`, or add `tini` and `ENTRYPOINT ["/sbin/tini","--"]`) so
   killed processes are reaped (S20).

**Approve (architectural, S19):** move program execution into a network-less sandbox. Options, in order
of effort:
- **bubblewrap/nsjail inside the existing container** — `--unshare-net --unshare-pid`, read-only bind of
  toolchains, writable run dir only. Requires the Railway container to permit user namespaces (needs
  checking on Railway; often unavailable on PaaS).
- **Separate runner service** on an internal-only network with no egress (Docker `--network none` per
  run, or a small VM), fed by the existing `ExecutionController` over a local queue. Most robust; adds an
  infrastructure component.
Until one is in place, treat every run as able to reach the internet.
