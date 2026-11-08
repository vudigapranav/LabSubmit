# ENGINEERING_STATE.md

Persistent engineering state across sessions. Updated at the end of every iteration.
History of each iteration: `ENGINEERING_CHANGELOG.md`. Feature inventory: `/STATE.md`.

**Last updated:** 2026-11-08, after iteration 5.
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
- Iteration 4: JWT startup validation (`server.js` refuses to start without a usable
  `JWT_SECRET`/`DATABASE_URL`); token/role/expiry test coverage; README env section fixed;
  STATE.md reconciled. Suite at 47 tests, all passing in dev and production mode.
- Iteration 5: S8 — Next 14.2.35, non-breaking transitive fixes, image optimizer disabled,
  stray WebSocket upgrades closed in production. Suite 51 (all pass in production; 4
  production-only tests skip in dev by design).

## In progress / next

- All P0 items in `MVP_ROADMAP.md` are done except the Railway uid drop (awaiting approval).
- Next, per owner direction (2026-11-08): next security item → `ExecutionRecord` persistence →
  section-wise evaluation. Lint config and docs follow.


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
- **Owner decision needed:** Next 15.5+ major upgrade (React 19) to clear residual S8 advisories.
- **Local install note:** this machine's npm skips install scripts unless approved
  (`npm install-scripts approve <pkg>`); a fresh clone needs node-pty/prisma scripts approved.
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
npm test        # loads tsx so tests can import src/**/*.ts directly
```

## Files modified in this phase

`src/lib/execution/{CompilerService,PtyService,ExecutionController}.ts`,
`src/lib/execution/sandbox.ts` (new), `src/lib/sourceFilename.ts` (new),
`src/app/api/student/workspace/route.ts`, `src/app/api/lecturer/labs/route.ts`,
`src/app/api/auth/login/route.ts`, `src/lib/jwt.ts`, `src/lib/rateLimit.ts` (new), `package.json`,
`tests/*`, `docs/*`.

## Next recommended action

Iteration 6: `ExecutionRecord` persistence, then iteration 7: section-wise evaluation.
