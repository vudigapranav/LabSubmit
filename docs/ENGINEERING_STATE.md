# ENGINEERING_STATE.md

Persistent engineering state across sessions. Updated at the end of every iteration.
History of each iteration: `ENGINEERING_CHANGELOG.md`. Feature inventory: `/STATE.md`.

**Last updated:** 2026-11-08, after the security blocker closure milestone.
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
- Iteration 6: `ExecutionRecord` persistence + faculty API + inspector Runs tab with Output
  matching. Suite 62 (all pass in production mode); 13/13 browser checks in Chrome.
- Iteration 7: section-wise evaluation rolling up into the total; flat marks validated; grading
  panel prefills and gains a publish control; student breakdown. Suite 75 (all pass in
  production); browser 23/23 (+ Runs tab 13/13 re-run).
- Iterations 8–10 — security assessment: threat model, API matrix, Linux engine probes; fixed S10, S11,
  S13–S18, S23, S26, S27; per-run uid pool (`EXEC_RUN_UID_RANGE`) for S4. Suite 91/91 (production);
  browser 47/47. Deliverables: `SECURITY_AUDIT.md`, `THREAT_MODEL.md`, `API_SECURITY_MATRIX.md`,
  `COMPILER_SECURITY_REVIEW.md`, `SECURITY_REMEDIATION_LOG.md`, `SECURITY_TEST_RESULTS.md`.
- Iterations 11–14: immutable hashed submissions + idempotent submit; server-clock countdown;
  hash-chained audit log; code autosave with safe recovery and versioned saves; exam editor layout
  fix. Suite 113/113 (production); browser 73/73. Scope map for the 2026-11-08 modules brief:
  `SCOPE_STATUS.md`.
- Security blocker closure: seccomp network isolation, HMAC-signed snapshots/audit, append-only
  triggers, exam-delete guard, session/deadline and IDOR test matrices, migration plan rehearsed,
  staging on the production image (found and fixed an image crash). Staging 131/131; local 128 + 7
  skips. Report: `SECURITY_BLOCKER_CLOSURE_REPORT.md`.

## In progress / next

- All P0 items in `MVP_ROADMAP.md` are done except the Railway uid drop (awaiting approval).
- Security status: **NOT READY FOR PRODUCTION / SECURE FOR TESTING** (see `SECURITY_AUDIT.md`).
- Next by roadmap: lint config (P1 #5); low/info security items S9–S11; README rewrite and
  DATABASE/API/JURY docs (P3 #12); pre-existing UI defects listed in STATE.md §3b.


## Pending (see `MVP_ROADMAP.md`)

Lint config · Next.js patch upgrade (S8) · uid drop on Railway image (needs approval) ·
`ExecutionRecord` persistence · section-wise evaluation · user deactivation/revocation (S9) ·
S10/S11 · README + DB/API/jury documentation.

## Failed tests

None at last run.

## Known bugs / blockers

- **Deploy prerequisite:** `JWT_SECRET` must be set on both hosts; without it logins now fail (by design).
- S4 Linux verification: **done** (iteration 10, `COMPILER_SECURITY_REVIEW.md`).
- **Owner decision needed:** Next 15.5+ major upgrade (React 19) to clear residual S8 advisories.
- **Local install note:** this machine's npm skips install scripts unless approved
  (`npm install-scripts approve <pkg>`); a fresh clone needs node-pty/prisma scripts approved.
- **Production change awaiting approval:** set `EXEC_RUN_UID_RANGE=20000-20099` on Railway (no image
  user needed; the server already runs as root) and run with `--init`/tini. Verified in a Linux container.
- **Deploy prerequisite:** production seeding now needs `SEED_ADMIN_PASSWORD` (see `DEPLOYMENT.md`).
- **Local dev gotcha:** on macOS run
  `chmod +x node_modules/node-pty/prebuilds/darwin-*/spawn-helper` after `npm install`, or
  every execution fails with `posix_spawnp failed`.

## Browser verification

Not in the repo (needs `playwright-core`, which is not a project dependency). Iteration 6 used
`playwright-core@1.48.2` installed in the session scratchpad, driving the system Google Chrome.
Committing a browser suite would need an approved devDependency.

## Architecture decisions

- Filename rule lives in a dependency-free module (`src/lib/sourceFilename.ts`) shared by the
  REST route and the engine — one rule, two entry points (CLAUDE.md §6 "pure modules").
- Execution policy (env, limits, identity) centralised in `src/lib/execution/sandbox.ts`.
- Run capture rules live in one dependency-free module (`src/lib/runTranscript.ts`) used by
  both the browser terminal and the engine, so the evaluator's Output-vs-run comparison
  compares like with like.
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

**Next: owner performs the manual actions in `SECURITY_BLOCKER_CLOSURE_REPORT.md`; then the Live
Exam Control Room milestone.** Also open: owner decisions on the modules brief: auto-grading vs CLAUDE.md, SQL workbench, practice
projects/achievements (`SCOPE_STATUS.md`). Then, in order of impact: (1) set `EXEC_RUN_UID_RANGE` on Railway and add an init
process (S4, S20); (2) choose a network-less sandbox (S19); (3) account issuance for S28; (4) Next 15.5
upgrade (S8). Then lint config and S9.
