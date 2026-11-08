# ROLE_PERMISSION_MATRIX.md

Capability view of the authorisation model. Endpoint-level detail (every handler, its guard and its
test): `API_SECURITY_MATRIX.md`. All checks are server-side; the UI only hides what the server refuses.

| Capability | STUDENT | LECTURER | ADMIN | Enforced by | Automated test |
|---|---|---|---|---|---|
| Sign in / own profile / own password | ✅ | ✅ | ✅ | `requireAuth` | jwt, security-module |
| See an exam / its paper | own cohort, after own Start | own exams | all | `examAccess`, labs GET | security-module S13, access-control S6 |
| Edit own exam files and answers | own attempt, before deadline | — | — | workspace POST | access-control S12 |
| Run code | own attempt, RUNNING | own exams | all | `authorizeRun` | execution-security, jwt |
| Create / edit / publish exams | — | own subjects only | any subject | labs POST/PUT | security-module S23, audit-log |
| Question sets and assignment | — | own exams | all | `assertLabAccess` | prior E2E (STATE.md) |
| View submissions / run history | — | own exams | all | submissions, executions | execution-records, submission-integrity |
| Grade, publish/withdraw results | — | own exams | all | evaluate | section-evaluation, audit-log |
| See own results | published only | — | — | grades | section-evaluation |
| Manage users, branches, subjects | — | read branches/subjects | ✅ | admin routes | jwt role matrix, leak scan |
| Reset passwords | — | — | ✅ | reset routes | security-module S18 |
| Read / export / verify audit log | — | — | ✅ | admin/audit | audit-log |
| Change a user's role | — | — | **no endpoint exists** | — | — |

Cross-student access, IDOR and privilege escalation are covered by: role matrix (5 endpoints × 3 roles),
GET leak scan (20 × 4), file IDOR (S12), cohort (S13), subject placement (S23), executions ownership,
evaluate ownership, tampered-role tokens (jwt).
