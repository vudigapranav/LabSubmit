# ENGINEERING_STATE.md

Persistent engineering state across sessions. Updated at the end of every iteration.
History of each iteration: `ENGINEERING_CHANGELOG.md`. Feature inventory: `/STATE.md`.

**Last updated:** 2026-11-08, after iteration 3.
**Branch:** `claude/labsubmit-development-y605fv` (not pushed since `85240d1`; owner pushes after review).

## Current phase

Stage 5 — IMPLEMENT, working through the P0 security items in `MVP_ROADMAP.md`.

## Completed

- Iteration 0: audit documents in `docs/`.
- Iteration 1: execution engine containment — S1, S2, S3 fixed and verified; S4 partially
  mitigated. First committed test suite (`npm test`).
- Iteration 2: S5 (no JWT fallback secret), S6 (students can no longer list exam papers),
  S12 (file actions scoped to own workspace).
- Iteration 3: S7 login hardening (generic errors, timing equalisation, failure limiter).
  Suite at 30 tests, all passing in dev and production mode; `npm run build` succeeds.

## In progress / next

- All P0 items in `MVP_ROADMAP.md` are done except the Railway uid drop (awaiting approval).
- Next: P1 — lint config, Next.js 14.2.x patch upgrade (S8).


## Pending (see `MVP_ROADMAP.md`)

Lint config · Next.js patch upgrade (S8) · uid drop on Railway image (needs approval) ·
`ExecutionRecord` persistence · section-wise evaluation · user deactivation/revocation (S9) ·
S10/S11 · README + DB/API/jury documentation.

## Failed tests

None at last run.

## Known bugs / blockers

- **Deploy prerequisite:** `JWT_SECRET` must be set on both hosts; without it logins now fail (by design).
- **S4 Linux verification outstanding.** `ulimit -v`, `/proc` environ protection and the uid
  drop have not been executed on Linux.
- **Production change awaiting approval:** add an unprivileged user to the `Dockerfile` and
  set `EXEC_RUN_UID`/`EXEC_RUN_GID` on Railway.
- **Local dev gotcha:** on macOS run
  `chmod +x node_modules/node-pty/prebuilds/darwin-*/spawn-helper` after `npm install`, or
  every execution fails with `posix_spawnp failed`.

## Architecture decisions

- Filename rule lives in a dependency-free module (`src/lib/sourceFilename.ts`) shared by the
  REST route and the engine — one rule, two entry points (CLAUDE.md §6 "pure modules").
- Execution policy (env, limits, identity) centralised in `src/lib/execution/sandbox.ts`.
- Tests use Node's built-in `node:test` against a real server, real Postgres and real
  compilers — no new dependencies, no mocks.

## How to run tests

```bash
PORT=3100 NODE_ENV=development node server.js &   # needs .env and a seeded DB
npm test
```

## Files modified in this phase

`src/lib/execution/{CompilerService,PtyService,ExecutionController}.ts`,
`src/lib/execution/sandbox.ts` (new), `src/lib/sourceFilename.ts` (new),
`src/app/api/student/workspace/route.ts`, `src/app/api/lecturer/labs/route.ts`,
`src/app/api/auth/login/route.ts`, `src/lib/jwt.ts`, `src/lib/rateLimit.ts` (new), `package.json`,
`tests/*`, `docs/*`.

## Next recommended action

P1 task 5 (lint config), then task 6 (Next.js patch upgrade, S8), re-running `npm test` and `npm run build` after each.
