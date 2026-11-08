# AUDIT_LOGGING_DESIGN.md

**Implemented** (iteration 13): `AuditEvent` (Prisma), `src/lib/audit.ts`, `GET /api/admin/audit`,
`tests/audit-log.test.mjs`.

## Record

`seq` (gapless, assigned under lock) · `at` (server time) · `actorId` / `actorRole` (`SYSTEM` for
automatic actions) · `action` · `category` (AUTH, ADMIN, EXAM, SUBMISSION, GRADING) · `targetType` /
`targetId` · `metadata` (JSON, redacted) · `ip` · `prevHash` · `hash`.

`hash = SHA-256(prevHash + canonicalJSON(seq, at, actor, action, category, target, metadata, ip))`;
the first row links to 64 zeros.

## Events recorded

| Category | Actions |
|---|---|
| AUTH | `AUTH_LOGIN_SUCCESS`, `AUTH_LOGIN_FAILED` (identifier, whether the account exists), `AUTH_LOGIN_THROTTLED`, `AUTH_STUDENT_REGISTERED` |
| ADMIN | `ADMIN_LECTURER_CREATED/UPDATED/DELETED`, `ADMIN_STUDENT_UPDATED/DELETED`, `ADMIN_PASSWORD_RESET`, `AUDIT_EXPORTED` |
| EXAM | `EXAM_CREATED`, `EXAM_UPDATED` (before/after of schedule, publish, languages, placement, device and mode flags), `EXAM_PUBLISHED`, `EXAM_UNPUBLISHED`, `EXAM_DELETED`, `EXAM_ATTEMPT_STARTED` |
| SUBMISSION | `SUBMISSION_FINALIZED` (version, snapshot hash, auto/reason, on-time, server time) |
| GRADING | `GRADE_SAVED` (before/after status, marks, max, publish; section marks), `RESULT_PUBLISHED`, `RESULT_WITHDRAWN` |

Question-set administration keeps its existing `ExamAdminAction` trail. **Not yet recorded:** logout
(client-side only), branch/subject/roll-range changes, per-run execution events (runs are stored in
`ExecutionRecord`), integrity events (stored in `ExamViolation`).

## Guarantees and limits

- **Tamper-evident against privileged DB access.** Editing, deleting, inserting or reordering a row is
  detected at that row. Each row is also HMAC-signed with `INTEGRITY_KEY` (server env only), so
  rewriting the chain with recomputed hashes, or stripping signatures, is detected too (tested as a DB
  owner with triggers disabled). `prisma/sql/001_append_only.sql` makes the table refuse UPDATE/DELETE.
  Someone with both DB access and the server environment could still forge — **anchoring** the latest
  hash off-site (e.g. a daily email to the HOD) covers that; not automated.
- **No forks:** appends hold `pg_advisory_xact_lock`; 25 concurrent events → gapless, verifying chain (tested).
- **Never stores secrets:** keys matching password/token/secret/authorization/cookie are redacted at
  any depth; tests assert the login password and token never appear.
- **Fail-open:** an audit write failure is logged (`[AUDIT]`) and does not fail the user's action.
  Chosen so a database hiccup cannot block a submission; the cost is a possible missing event.

## Access, export, retention

Admin only. Filters: action, category, actorId, targetId, from/to; newest-first paging (`before`).
CSV export quotes every cell and neutralises spreadsheet formulas; each export is itself audited.
**Retention is not automated**: deleting old rows would break verification — the design for
retention is to archive a closed range together with its final hash, then start a new chain anchored
on it. Not built.
