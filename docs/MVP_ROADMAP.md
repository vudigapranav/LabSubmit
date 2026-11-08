# MVP_ROADMAP.md — LabSubmit

Sequenced by severity, then dependency. A task is done only with recorded evidence in
`ENGINEERING_CHANGELOG.md`.

## Completed before this roadmap (see `/STATE.md` §1)

Authentication for all three roles · server-side RBAC · admin user/branch/subject management ·
exam create/edit/publish/schedule · configurable answer sheet · multi-set randomized
questions with hidden identity · desktop-only exam enforcement · Monaco IDE + real
compiler + interactive terminal · server-authoritative deadlines and auto-submit · integrity
log · manual evaluation with publish toggle · student results · design system + responsive
dashboards.

## Priority order

| P | # | Task | Owner | Depends on | Size | Acceptance criteria |
|---|---|---|---|---|---|---|
| P0 | 1 | ✅ (iter. 1; Linux uid drop pending) **Execution engine containment** (S1–S3, S4 partial) | Ritwik (review: Pranav) | — | M | Student program cannot read `JWT_SECRET`/`DATABASE_URL` from env; `../` or shell-metacharacter filenames rejected before any write; compile uses no shell; ulimits applied; C/C++/Java/Python still compile and run with interactive stdin |
| P0 | 2 | ✅ (iter. 2, 4) **Remove JWT fallback; block student access to all exam papers** (S5, S6) | Ritwik | — | S | No token issued/accepted without `JWT_SECRET`; student token gets 403 from `GET /api/lecturer/labs`; lecturer/admin dashboards unaffected |
| P0 | 3 | ✅ (iter. 3) **Login hardening** (S7) | Ritwik | — | S | Identical response for unknown user and wrong password; 429 after repeated failures; valid logins unaffected for all roles |
| P1 | 4 | ✅ (iter. 1–7; no CI yet) Committed regression test harness (`npm test`) covering auth, RBAC, execution security | Ritwik | 1–3 | M | Runs against local Postgres + compilers; exits non-zero on failure |
| P1 | 5 | Working lint config (`npm run lint` non-interactive) | Pranav | — | S | Lint runs in CI mode; existing code passes or has recorded exceptions |
| P1 | 6 | ✅ (iter. 5; residual needs 15.5+) Next.js patch upgrade within 14.2.x (S8) | Pranav | 4 | S | `npm audit` no longer lists Next criticals fixed in 14.2.x; build + regression pass |
| P1 | 7 | Enable uid drop on Railway image (S4) — **needs owner approval** | Pranav | 1 | S | Runner uid in Dockerfile; `/proc/<server>/environ` unreadable from student code in the container |
| P2 | 8 | ✅ (iter. 6) Persist `ExecutionRecord` per run; show run history to evaluator | Ritwik | 1 | M | Each run stored (truncated output); evaluator sees history |
| P2 | 9 | ✅ (iter. 7) Section-wise evaluation (`SectionEvaluation`) rolling up into total | Ritwik + Pranav | — | M | Per-section marks saved; total = sum; student sees breakdown when published |
| P2 | 10 | User deactivation (verify / add `isActive`) + session revocation (S9) | Ritwik | 4 | M | Deactivated user cannot log in or use an existing token |
| P2 | 11 | Low/info findings S10, S11 | Ritwik | — | S | — |
| P3 | 12 | Docs: `README.md` rewrite, `DATABASE_DOCUMENTATION.md`, `API_DOCUMENTATION.md`, `JURY_PRESENTATION_NOTES.md`, demo runbook | Pranav | 1–9 | M | Every statement traceable to code |
| P3 | 13 | UI debt from STATE.md §3b (admin tables on primitives + mobile cards) | Pranav | — | M | Verified at 1440/834/390 |
| Opt | — | Notices module, plagiarism, proctoring | — | — | — | Not before P0–P2 |

## Team split

- **Pranav (lead):** architecture, frontend, integration, Dockerfile/deploy changes, final review, jury.
- **Ritwik:** backend routes, DB, auth, execution engine, backend tests.

Shared critical files — coordinate before editing in parallel: `prisma/schema.prisma`,
`src/lib/execution/ExecutionController.ts`, `src/app/api/student/workspace/route.ts`,
`src/components/ui/index.tsx`.

Independent in parallel: tasks 5, 6 and 13 (Pranav) alongside 2, 3, 8 (Ritwik).
