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
