-- Append-only protection for evidence tables (SECURITY_BLOCKER_CLOSURE_REPORT.md, item 4).
-- Idempotent: safe to run repeatedly. Apply with:  npm run db:protect
--
-- AuditEvent:          no UPDATE, no DELETE — the log is append-only.
-- SubmissionSnapshot:  no UPDATE — a hand-in never changes. DELETE stays possible because
--                      snapshots cascade from their Submission (admin deletion of a user or an
--                      exam), which the application audits.
--
-- This stops accidental and application-level modification. A database OWNER can still
-- disable a trigger; that case is caught by the keyed signatures (INTEGRITY_KEY) and by
-- off-site anchoring of the latest audit hash — see AUDIT_LOGGING_DESIGN.md. For the strongest
-- setup, run the application as a database role that does not own these tables.

CREATE OR REPLACE FUNCTION labsubmit_refuse_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'LabSubmit: % on % is not allowed (append-only evidence table)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_event_append_only ON "AuditEvent";
CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION labsubmit_refuse_modification();

DROP TRIGGER IF EXISTS submission_snapshot_immutable ON "SubmissionSnapshot";
CREATE TRIGGER submission_snapshot_immutable
  BEFORE UPDATE ON "SubmissionSnapshot"
  FOR EACH ROW EXECUTE FUNCTION labsubmit_refuse_modification();
