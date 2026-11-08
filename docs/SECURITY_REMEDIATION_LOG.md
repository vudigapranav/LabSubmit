# SECURITY_REMEDIATION_LOG.md

One row per fix: what was reproduced, what changed, how it was retested. Commits are on
`claude/labsubmit-development-y605fv` (not yet pushed). Loop per fix: observe → reproduce (failing test) →
fix → retest → regression suite.

| ID | Reproduced before fix | Change | Commit | Retest |
|---|---|---|---|---|
| S1 | Python program printed presence of `JWT_SECRET`/`DATABASE_URL` | Allow-listed env (`sandbox.ts`) for compile and run | `2a109ad` | `execution-security` S1; Linux P1 CLEAN |
| S2 | `../` filenames written into `$TMPDIR` | Filename allow-list at engine + REST; resolved-path check | `2a109ad` | 2 tests; no files written |
| S3 | `$(touch …)` in a filename | `execFile` arrays, no shell | `2a109ad` | S3 test |
| S4 | Linux: `/proc/<ppid>/environ` read incl. `JWT_SECRET`; server signalable; `/etc` writable; other runs readable; 300 procs; `setsid` escape | ulimits (it.1); optional single uid (it.1); per-run uid pool, `ulimit -u`, uid reaping, `umask 077` (it.10); pool state on `globalThis` | `2a109ad`, `f266839` | Linux probes P2/P3/P7/P8/P9/P11 blocked in pool mode; 4 languages OK; uid reuse OK. **Not deployed** |
| S5 | Fallback secret signed tokens; README told users to use it | No fallback; startup refusal; HS256 pinned; README fixed | `f041e06`, `8421569` | `jwt.test.mjs` 17 |
| S6 | Student token listed all exams with papers | STUDENT removed from GET | `f041e06` | access-control S6 |
| S7 | Distinct errors; unlimited guesses | Generic error, dummy hash, failure limiter | `5cef040` | `auth.test.mjs` 7 |
| S8 | `npm audit`: Next 14.2.10 criticals; optimiser 200; stray upgrade held open | Next 14.2.35; 6 transitive bumps; optimiser off; stray upgrades closed (prod) | `9c29209` | framework-hardening 4 (prod) |
| S10 | Directory returned 200 to anonymous users | ADMIN/LECTURER only | `078d90a` | security-module S10 |
| S11 | 43 handlers returned `error.message` | Generic message + server log | `078d90a` | static test (0 remaining) |
| S12 | Student A overwrote student B's file (200) | File must be in caller's workspace | `f041e06` | 3 tests |
| S13 | Paper returned cross-cohort, while UPCOMING, and before Start | Cohort rule; paper only after own Start; cohort re-check on `start_exam` | `078d90a` | 4 API tests; browser 11/11 |
| S14 | 600 KB file, 200 KB answer, unlimited files accepted | 256 KB / 64 KB / 20 files | `078d90a` | 3 tests |
| S15 | 3 parallel runs started; 4 MB frame accepted | ≤2 runs per user (atomic); `maxPayload` 2 MB | `ad61c08` | 2 tests |
| S16 | SIGHUP-immune child survived the run | Kill process group; pool mode kills all of the uid | `ad61c08`, `f266839` | S16 test; Linux P10/P11 |
| S17 | No anti-framing headers; `X-Powered-By` | Headers in `next.config.mjs` | `078d90a` | S17 test |
| S18 | Password `1` accepted | `passwordPolicy.ts` on 5 paths | `078d90a` | 2 tests |
| S23 | Exam created under another lecturer's subject | Subject ownership + cohort match on create/move | `ebcfff5` | S23 test |
| S26 | Build context contained `.env` | `.dockerignore` | `12e2918` | throwaway build: before yes / after no |
| S27 | Seed wipes all tables; public admin password; guide ran it in production | Production guard (password required; refuses non-empty DB); guide fixed | `0d66320` | guard refused twice; user count unchanged |

## Corrections during the loop (honest record)

- **S16 test was too gentle at first** — a plain child dies of SIGHUP anyway; rewritten to ignore SIGHUP.
- **First Linux "uid drop" pass did not apply the flag** (zsh does not word-split `$mode`); rerun with explicit flags.
- **P10/P11 "SURVIVED" was a zombie** (killed, unreaped by PID 1); the probe now reports process state.
- **Pool uid leak observed** under tsx's ESM loader (two module instances); production CJS path was fine,
  but pool state was moved to `globalThis` so a duplicate instance can never drain the pool.
- **S23 baseline first failed for the wrong reason** (incomplete request body → 400); corrected to reach the
  ownership logic before claiming a reproduction.
- **Full suite hung once** against the *unfixed* engine (SIGHUP-immune child keeping the run open); does not
  occur with the fixes; tests now run with a per-test timeout.
- **S27 guard check #2 ran against the local dev database**; the guard refused before any write
  (6 users before and after) — a disposable database would have been the safer choice.

## Not fixed — needs a decision

| ID | Why not fixed here |
|---|---|
| S4 (deployment) | Setting `EXEC_RUN_UID_RANGE` on Railway is a production change |
| S19 | Needs a network-less sandbox — architectural |
| S20 | Needs an init process in the image — deployment change |
| S8 residual | Next 15.5 + React 19 — major upgrade |
| S9 | Session revocation needs `requireAuth` to become async across all routes |
| S28 | Account-issuance design (admin-issued passwords or email verification) |
