# API_SECURITY_MATRIX.md — LabSubmit

Every route handler in `src/app/api` (enumerated from the code: 28 files, 48 method handlers) plus the
execution WebSocket. **Roles** are the `requireAuth` list in the handler. **Ownership** is the
object-level check after the role check. **Tested** names the dynamic evidence (test file in `tests/`
or the GET leak scan); "static" means verified by reading code only.

Common to all handlers: no raw SQL (Prisma, parameterised); 500 responses return a generic message
(S11, static test); security headers on every response (S17). No cookies are set, so CSRF does not apply.

**GET leak scan** (iteration 8): 20 GET endpoints × {ADMIN, LECTURER, STUDENT, no token} — every response
matched the role list below (401 without token, 403 wrong role), and **no response contained a bcrypt
hash or a `password` field**.

## Authentication

| Endpoint | Method | Roles | Controls | Issues | Tested |
|---|---|---|---|---|---|
| `/api/auth/login` | POST | public | bcrypt; generic error; dummy hash for unknown users; failure limiter 10/acct, 100/IP per 15 min; tab-role check after password | S7 fixed | `auth.test.mjs` (7) |
| `/api/auth/register-student` | POST | public | roll number must fall in an admin range; duplicate check; password policy | S18 fixed; **S28 open** (roll-number squatting) | static + policy unit |
| `/api/auth/me` | GET | any | reads own user by token id | — | `jwt.test.mjs`, leak scan |
| `/api/auth/lecturers-available` | GET | ADMIN, LECTURER | — | S10 fixed (was public) | `security-module` S10 |
| `/api/profile` | PUT | any | allow-listed fields; current password required to change; password policy | S18 fixed | `security-module` S18 |
| `/api/profile/theme` | POST | any | own row only | — | static |
| `/api/public/branches` | GET | public | active branches only (registration form) | none (non-sensitive) | leak scan |

## Admin

| Endpoint | Method | Roles | Ownership | Issues | Tested |
|---|---|---|---|---|---|
| `/api/admin/stats` | GET | ADMIN | — | — | role matrix, leak scan |
| `/api/admin/lecturers` | GET/POST/PUT/DELETE | ADMIN | — | password policy on POST | leak scan; static |
| `/api/admin/lecturers/reset-password` | POST | ADMIN | — | policy enforced | `security-module` S18 (student twin) |
| `/api/admin/students` | GET/PUT/DELETE | ADMIN | — | — | leak scan |
| `/api/admin/students/reset-password` | POST | ADMIN | — | policy enforced | `security-module` S18 |
| `/api/admin/branches` | GET (ADMIN, LECTURER) · POST/PUT/DELETE (ADMIN) | as listed | — | — | leak scan |
| `/api/admin/subjects` | GET (ADMIN, LECTURER) · POST/PUT/DELETE (ADMIN) | as listed | — | — | leak scan |
| `/api/admin/roll-ranges` | GET | ADMIN | — | — | leak scan |

## Lecturer

| Endpoint | Method | Roles | Ownership | Issues | Tested |
|---|---|---|---|---|---|
| `/api/lecturer/labs` | GET | LECTURER, ADMIN | lecturer sees own exams | S6 fixed (student removed) | `access-control` S6 |
| `/api/lecturer/labs` | POST | LECTURER, ADMIN | lecturer must teach the subject; cohort must match subject | **S23 fixed** | `security-module` S23 |
| `/api/lecturer/labs` | PUT | LECTURER, ADMIN | `lab.lecturerId`; subject placement re-checked on move | S23 fixed | `security-module` S23 |
| `/api/lecturer/labs` | DELETE | LECTURER, ADMIN | `lab.lecturerId` | — | static |
| `/api/lecturer/question-sets` | GET/POST/PUT/DELETE | LECTURER, ADMIN | `assertLabAccess` (lab owner); live-set edits need acknowledgement; delete of in-use set refused | — | prior E2E (STATE.md), leak scan |
| `/api/lecturer/assignments` | GET/POST | LECTURER, ADMIN | `assertLabAccess`; client `questionSetId` ignored | — | prior E2E, leak scan |
| `/api/lecturer/submissions` | GET | LECTURER, ADMIN | filtered to own labs | — | `section-evaluation` |
| `/api/lecturer/evaluate` | POST | LECTURER, ADMIN | submission's lab owner; marks validated; publish needs complete section marks | validation added (it.7) | `section-evaluation` (13) |
| `/api/lecturer/executions` | GET | LECTURER, ADMIN | submission's lab owner; same 404 for missing and foreign | — | `execution-records` |
| `/api/lecturer/violations` | GET | LECTURER, ADMIN | own labs | — | leak scan |
| `/api/lecturer/sections` | GET | LECTURER, ADMIN | own subjects | — | leak scan |
| `/api/lecturer/students` | GET | LECTURER, ADMIN | **none** — any cohort | S22 accepted | leak scan |

## Student

| Endpoint | Method | Roles | Ownership | Issues | Tested |
|---|---|---|---|---|---|
| `/api/student/labs` | GET | STUDENT | own cohort; published only | — | role matrix |
| `/api/student/grades` | GET | STUDENT | own submissions; published only | — | `section-evaluation` |
| `/api/student/workspace` | GET | STUDENT | own workspace; **cohort check on first open; paper only after own Start**; set identity stripped; device withholding | **S13 fixed** | `security-module` S13, browser 11/11 |
| `/api/student/workspace` | POST | STUDENT | own workspace; cohort on `start_exam`; files must be own (S12); filename rule; size limits (S14); deadline and submitted lock re-checked; device check | S12, S13, S14 fixed | `access-control`, `security-module` |
| `/api/student/heartbeat` | POST | STUDENT | own workspace by `labId` + token | — | static |
| `/api/student/violations` | POST | STUDENT | own workspace; type allow-list; severity server-assigned | — | static |

## Execution WebSocket — `/api/ws` (Railway)

| Message | Controls | Issues | Tested |
|---|---|---|---|
| connection | `maxPayload` 2 MB; production closes any other upgrade path | S15, S8 fixed | `security-module` S15, `framework-hardening` |
| `run` | JWT verified per run; lecturer must own the lab; student: device, own workspace, not submitted, RUNNING, deadline, allowed language; filename rule; ≤20 files, ≤1 MB; ≤2 concurrent runs per user; uid from pool when configured | S1–S4, S15 | `execution-security` (12), `jwt` (expired token), `security-module` |
| `input` / `resize` / `stop` | act only on this socket's own session | — | `execution-records` (stop) |
| output routing | each socket's controller owns its session; output is sent only on that socket | cross-user delivery not possible by construction | static + concurrent-run tests |
| `Origin` | not checked | S21 accepted (token-in-message, no cookies) | static |
