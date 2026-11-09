# DB_MIGRATION_PLAN.md — deploying this branch's schema to production

**Not executed against production.** Every step below was rehearsed on a scratch PostgreSQL
database built from the pre-session schema (commit `85240d1`) and filled with seed data plus a
graded, published submission and an in-progress attempt (2026-11-08).

## What changes

Generated with `prisma migrate diff --from-schema-datamodel <85240d1 schema> --to-schema-datamodel prisma/schema.prisma --script`:

| Change | Kind | Origin |
|---|---|---|
| `CREATE TABLE "SubmissionSnapshot"` (+ 2 indexes, FK → `Submission` ON DELETE CASCADE) | additive | security work |
| `CREATE TABLE "AuditEvent"` (+ 5 indexes; `signature` column) | additive | security work |
| `Lab.archivedAt`, `Lab.resultsReleasedAt` (nullable) | additive | remote `1bbd83b`, `ac9c535` |
| `ExamAdminAction.labTitle` added; `labId` made nullable; its FK becomes `ON DELETE SET NULL` | widening | remote `1bbd83b` |
| No existing column is renamed or dropped; no data is rewritten by the schema push | — | — |

**Remote commits rebased in (2026-11-09).** The diff was regenerated after rebasing onto
`origin/claude/labsubmit-development-y605fv` (`ac9c535`). The rehearsal below covered the security
tables; the remote's columns were applied to the local dev database with `prisma db push`
("in sync", no data-loss warning).

Plus, outside Prisma: `prisma/sql/001_append_only.sql` (one function, two triggers on the new tables).

## Rehearsal evidence

| Step | Result |
|---|---|
| Old schema + seed + attempts | 5 users, 3 labs, 1 workspace, 1 file, 1 submission (marks 72, published) |
| `pg_dump -Fc` backup | 43 KB |
| `prisma db push` (no `--accept-data-loss`) | "in sync", **no data-loss warning** |
| `npm run db:protect` | triggers installed |
| Row counts before vs after | identical; submission still 72 / published |
| App against migrated DB | legacy submission served (files from workspace, 0 snapshots, marks 72); a new audit event written **signed**; chain verifies |
| Rollback rehearsal | backup restored into a fresh DB → counts identical to pre-migration, new tables absent |

## Production procedure (manual — owner)

1. **Freeze**: no exam running; announce a short maintenance window.
2. **Backup**: `pg_dump "$DATABASE_URL" -Fc -f labsubmit-pre-migration.dump`; copy it off Railway;
   confirm Railway's own backups are enabled.
3. **Set** `INTEGRITY_KEY` (32+ random chars, e.g. `openssl rand -hex 32`) on **both** Vercel and Railway
   *before* the first deploy, so the first snapshots and audit rows are signed. Store it in a
   password manager — losing it makes signatures unverifiable (not invalid).
4. **Deploy** the image from this branch.
5. **Schema**: from the Railway shell, `npx prisma db push` — **stop if it prints any data-loss
   warning**; do not add `--accept-data-loss`.
6. **Backfill result release** (required here: production has grades published under the old
   save-publishes behaviour): run `prisma/backfill/2026-09-result-release.sql` once
   (`npx prisma db execute --file prisma/backfill/2026-09-result-release.sql --schema prisma/schema.prisma`).
   It is UPDATE-only and marks exams whose marks students can already see as released, so the
   exam-level switch and the visible rows agree. Without it those exams read "Results not
   released" while students can still see marks.
7. **Protect**: `npm run db:protect`.
8. **Verify**: log in as admin → `GET /api/admin/audit?verify=1` returns `ok: true`; a test submission
   shows "integrity verified" in the inspector.

## Rollback

The change is additive, so the old code runs against the new schema (it never touches the new
tables). To roll back the **code**, redeploy the previous image — no schema action needed. To remove
the new tables entirely (only if required):

```sql
DROP TRIGGER IF EXISTS audit_event_append_only ON "AuditEvent";
DROP TRIGGER IF EXISTS submission_snapshot_immutable ON "SubmissionSnapshot";
DROP TABLE IF EXISTS "AuditEvent";
DROP TABLE IF EXISTS "SubmissionSnapshot";
DROP FUNCTION IF EXISTS labsubmit_refuse_modification();
```

This **destroys hand-in snapshots and the audit trail** — prefer restoring the backup instead.

## Risks

- `db push` has no migration history; this repo keeps none (`CLAUDE.md` §9). The diff above is the record.
- Run the app as a database role that does **not** own `AuditEvent`/`SubmissionSnapshot` if the host
  allows it; otherwise an owner can disable the triggers (signatures still detect the change).
