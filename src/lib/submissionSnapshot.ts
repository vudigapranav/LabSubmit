// Canonical form and integrity hash of a submission snapshot. Server-only (node:crypto).
//
// The hash binds the content to WHO submitted WHAT for WHICH exam at WHAT server time and as
// which version, so a stored snapshot cannot be quietly edited, re-attributed or back-dated
// without the recomputed hash disagreeing. On its own that only stops naive edits — someone
// with database write access can rewrite a row and its hash together — so the hash is also
// HMAC-signed with INTEGRITY_KEY (integrityKey.ts), which a database-only attacker lacks.
import { createHash } from 'crypto';
import { integrityCheck, integrityKeyConfigured, integritySign, type SignatureState } from './integrityKey';

/** What the HMAC covers: the content hash, tagged so a signature cannot be replayed elsewhere. */
const signedMessage = (contentHash: string) => `labsubmit:snapshot:v1:${contentHash}`;
export function signSnapshotHash(contentHash: string): string | null {
  return integritySign(signedMessage(contentHash));
}

export interface SnapshotFile {
  filename: string;
  language: string;
  content: string;
}
export interface SnapshotAnswer {
  sectionKey: string;
  label: string;
  content: string;
}
export interface SnapshotIdentity {
  submissionId: string;
  labId: string;
  studentId: string;
  version: number;
  submittedAt: Date;
}

/** Stable order so the same content always serialises — and hashes — identically. */
export function canonicalFiles(files: SnapshotFile[]): SnapshotFile[] {
  return files
    .map((f) => ({ filename: f.filename, language: f.language, content: f.content }))
    .sort((a, b) => a.filename.localeCompare(b.filename));
}
export function canonicalAnswers(answers: SnapshotAnswer[]): SnapshotAnswer[] {
  return answers
    .map((a) => ({ sectionKey: a.sectionKey, label: a.label, content: a.content }))
    .sort((a, b) => a.sectionKey.localeCompare(b.sectionKey));
}

export function snapshotHash(identity: SnapshotIdentity, files: SnapshotFile[], answers: SnapshotAnswer[]): string {
  const payload = JSON.stringify({
    v: 1,
    submissionId: identity.submissionId,
    labId: identity.labId,
    studentId: identity.studentId,
    version: identity.version,
    submittedAt: identity.submittedAt.toISOString(),
    files: canonicalFiles(files),
    answers: canonicalAnswers(answers),
  });
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/** Recomputes the hash of a stored snapshot; false means the stored copy was altered. */
export function verifySnapshot(row: {
  submissionId: string;
  version: number;
  submittedAt: Date;
  files: unknown;
  answers: unknown;
  contentHash: string;
}, owner: { labId: string; studentId: string }): boolean {
  const files = Array.isArray(row.files) ? (row.files as SnapshotFile[]) : [];
  const answers = Array.isArray(row.answers) ? (row.answers as SnapshotAnswer[]) : [];
  return (
    snapshotHash(
      { submissionId: row.submissionId, labId: owner.labId, studentId: owner.studentId, version: row.version, submittedAt: row.submittedAt },
      files,
      answers
    ) === row.contentHash
  );
}

/**
 * Full check of a stored snapshot: does the content still match its hash, and does the hash
 * carry a valid keyed signature? A database-only attacker can make the first pass (recompute
 * the hash) but not the second.
 */
export function checkSnapshot(
  row: Parameters<typeof verifySnapshot>[0] & { signature?: string | null },
  owner: { labId: string; studentId: string }
): { hashValid: boolean; signature: SignatureState; trustworthy: boolean } {
  const hashValid = verifySnapshot(row, owner);
  const signature = integrityCheck(signedMessage(row.contentHash), row.signature);
  // With a key configured every new snapshot is signed, so an unsigned one is a stripped
  // signature (downgrade), not a legacy row. Set INTEGRITY_KEY before snapshots are first used.
  const trustworthy = hashValid && (signature === 'valid' || (signature === 'unsigned' && !integrityKeyConfigured()));
  return { hashValid, signature, trustworthy };
}
