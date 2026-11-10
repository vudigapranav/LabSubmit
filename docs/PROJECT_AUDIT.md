# PROJECT_AUDIT.md — LabSubmit

**Audit date:** 2026-11-08 · **Branch:** `claude/labsubmit-development-y605fv` · **Base commit:** `85240d1`
Companion documents: `SYSTEM_ARCHITECTURE.md`, `SECURITY_AUDIT.md`, `MVP_ROADMAP.md`,
`ENGINEERING_STATE.md`. Product direction lives in `/CLAUDE.md`; feature-level status in `/STATE.md`.

## 1. Executive summary

LabSubmit is **substantially built**, not a prototype. The full examination lifecycle —
admin provisioning → lecturer exam configuration → answer-sheet customisation → question
sets → randomized assignment → student attempt with a real compiler and interactive
terminal → submission → manual evaluation → published results — exists in code and was
verified end to end against PostgreSQL in earlier sessions (recorded in `STATE.md` §1).

The most serious problems are **not missing features but security defects in the code
execution engine** (student programs could read the JWT signing secret and write outside
their sandbox directory) and a handful of authorisation/authentication gaps. These are
release blockers and are being fixed first (see `SECURITY_AUDIT.md`).

Secondary gaps: no committed automated tests, no working lint config, a stale `README.md`,
a vulnerable Next.js patch level, and two schema-only features (`ExecutionRecord`,
`SectionEvaluation`).

**Readiness at audit time: PARTIALLY READY.** Functionally demonstrable; not safe to host
for real students until S1–S6 are closed.

## 2. Purpose

A digital laboratory examination and evaluation platform for college programming labs
(CBIT). Replaces the paper lab record + supervised practical with an invigilated, timed,
server-authoritative digital attempt, evaluated manually by faculty. There is deliberately
**no auto-grading**.

## 3. Repository structure (excluding `node_modules`, `.next`)

| Path | Responsibility |
|---|---|
| `server.js` | Custom Node entry: Next.js request handler + WebSocket upgrade at `/api/ws` for the execution engine |
| `src/app/` | Next.js App Router pages: `/`, `/login`, `/register`, `/student`, `/student/lab/[id]`, `/lecturer`, `/admin` |
| `src/app/api/` | REST route handlers grouped by role: `auth`, `admin`, `lecturer`, `student`, `profile`, `public` (28 route files) |
| `src/lib/` | Domain logic: auth/JWT, exam timing, integrity, submission finalisation, answer sheet, question sets, device eligibility |
| `src/lib/execution/` | Execution engine: controller, compiler, PTY, sandbox limits, session manager, cleanup, logging |
| `src/components/` | UI: design-system primitives (`ui/index.tsx`), `AppShell`, IDE, terminal, exam guard, answer sheet, configurators |
| `src/context/` | `AppContext` — client session, token, theme |
| `prisma/` | `schema.prisma` (17 models), `seed.ts`; stray legacy `dev.db` (SQLite, unused) |
| `public/` | Static assets |
| `Proposal/` | Project proposal / presentation documents (not code) |
| `docs/` | Engineering documentation (this audit) |

## 4. Technology stack (evidence: `package.json`, configs, source)

| Layer | Technology | Where | Essential? | Notes |
|---|---|---|---|---|
| Language | TypeScript (app), JavaScript (`server.js`, configs) | `src/**`, root | Yes | Strict TS; `any` used widely for API payloads |
| Framework | Next.js 14.2.10 App Router | `src/app` | Yes | Patch level has advisories (S8) |
| UI | React 18, Tailwind 3, `lucide-react` icons, `clsx`/`tailwind-merge` | `src/components` | Yes | Shared primitives in `ui/index.tsx` |
| Editor | Monaco (`@monaco-editor/react`) | `OnlineIDE.tsx` | Yes | |
| Terminal | xterm + fit addon | `Terminal.tsx` | Yes | |
| Realtime | `ws` WebSocket server | `server.js`, `ExecutionController` | Yes | Not on Vercel — Railway only |
| Process | `node-pty` (optional dep) | `PtyService.ts` | Yes on exec host | Native addon; interactive stdin |
| Compilers | gcc, g++, javac/java (OpenJDK 17), python3, node | `CompilerService.ts`, `Dockerfile` | Yes | Local toolchain, **not** a third-party compiler API |
| Auth | `jsonwebtoken` (HS256, 7 d), `bcryptjs` | `src/lib/jwt.ts`, `auth.ts` | Yes | Token in `Authorization` header or `token` cookie |
| DB | PostgreSQL via Prisma 5 | `prisma/schema.prisma`, `src/lib/db.ts` | Yes | `db push`, no migrations dir |
| Hosting | Vercel (UI+REST) + Railway (exec engine + Postgres) | `DEPLOYMENT.md`, `Dockerfile` | — | |
| CI/CD | None | — | — | No GitHub Actions |
| Tests | None committed | — | — | Prior verification was throwaway scripts |

**Language breakdown (application code, `src/` + `prisma/` + `server.js`):** ~14.3k lines,
overwhelmingly TypeScript/TSX; JavaScript only in `server.js` and config files; Prisma schema
DSL; CSS limited to `globals.css` (Tailwind). Java/C/C++/Python appear only as *languages the
platform compiles for students*, not as application code.

## 5. Compiler investigation (direct answers)

- **Service:** in-house. The Node process shells out to local compilers; no Judge0/JDoodle/etc.
- **Languages:** C, C++ (C++17), Java, Python 3 offered to exams; `.js` also runs if allowed.
- **Transport:** WebSocket `/api/ws`; the client sends `{type:'run', filename, code, files, token, labId}`.
- **Authentication:** JWT in the message, verified per run in `authorizeRun()` → workspace
  ownership → exam status → deadline → allowed language → device eligibility.
- **Where:** on the Railway host, in a temp dir under `os.tmpdir()`.
- **Isolation:** **weak** — see `SECURITY_AUDIT.md` S1–S4.
- **Test cases:** none evaluated server-side; evaluation is manual by design.
- **Results:** streamed as PTY output; exit code and duration sent at the end.
- **Errors/timeouts:** compile errors streamed; 15 s compile timeout; 60 s runtime timeout; 5 MB output cap.
- **Credentials:** no external compiler credentials exist; the risk was the reverse — server
  credentials exposed *to* student code (S1).

## 6. Functional audit (lifecycle)

| # | Step | Status | Evidence |
|---|---|---|---|
| 1 | Admin manages lecturer accounts | COMPLETE | `api/admin/lecturers`, admin page |
| 2 | Lecturer logs in | COMPLETE | `api/auth/login` |
| 3 | Lecturer creates exam | COMPLETE | `api/lecturer/labs` POST |
| 4 | Lecturer adds questions | COMPLETE | `api/lecturer/question-sets` (multi-set) or `problemStatement` |
| 5 | Marks / test cases | PARTIAL | Per-section and per-question marks; **no test cases** (manual evaluation by design) |
| 6 | Publish | COMPLETE | `isPublished`; drafts hidden from students |
| 7–10 | Student login, sees, opens, reads instructions | COMPLETE | `/student`, `api/student/labs`, `api/student/workspace` |
| 11–13 | Write, execute, see output | COMPLETE | Monaco + WebSocket PTY; verified with real C program (STATE.md) |
| 14–16 | Submit, validate, persist | COMPLETE | `finalizeSubmission()`; required-section validation on manual submit |
| 17–18 | Lecturer views & evaluates | COMPLETE (flat marks) | Submission Inspector, `api/lecturer/evaluate` |
| 19–20 | Results stored and shown | COMPLETE | `isPublished` on submission; `api/student/grades` |

Other features: admin user deactivation — NEEDS VERIFICATION (no `isActive` field seen in
the model list; delete exists). Execution history persistence — MISSING (schema only).
Section-wise marks — MISSING (schema only). Notices — MISSING.

## 7. Code quality & performance

- `npx tsc --noEmit`: clean at last recorded run (re-run each iteration; see changelog).
- `npm run lint`: **unusable** — no ESLint config; `next lint` enters interactive setup.
- No automated tests; no CI.
- Large components: `admin/page.tsx` (1178 lines), `lecturer/page.tsx` (1167), `OnlineIDE.tsx` (663).
- `GET /api/lecturer/labs` issues 3 count queries per lab (N+1 pattern) — fine at college scale, worth a `groupBy` later.
- Verbose debug `console.log` in `PtyService` (prints spawn args) on every run.
- `README.md` stale (documents removed routes and SQLite).

## 8. Critical issues (ordered)

1. S1/S2/S3/S4 — execution engine exposure (secret theft, arbitrary file write, shell injection, no isolation).
2. S5 — fallback JWT secret.
3. S6 — exam papers readable by any student.
4. S7 — login brute force / enumeration.
5. No regression test suite.

## 9. Recommendations

See `MVP_ROADMAP.md` for the sequenced plan. In short: close the security blockers, add a
committed test harness, fix lint, patch Next.js, then finish the two schema-only features,
then documentation for the jury.

## 10. Readiness assessment

**PARTIALLY READY** at audit time. Reassessed in `ENGINEERING_STATE.md` after each iteration.
