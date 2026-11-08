// Keyed integrity signatures (HMAC-SHA256) for submission snapshots and audit rows.
// Server-only.
//
// Why a key: a plain SHA-256 stored next to the data proves nothing to someone who can write
// the database — they edit the row and recompute the hash. An HMAC needs INTEGRITY_KEY, which
// lives only in the server environment (never in the database, never passed to student
// programs — see execution/sandbox.ts env allow-list). Someone with database access but not
// the server's environment cannot produce a valid signature, so their edit is detected.
// Someone with BOTH (full server compromise) is out of scope for any in-app control; that is
// what off-site anchoring is for (AUDIT_LOGGING_DESIGN.md).
import { createHmac, timingSafeEqual } from 'crypto';

export const MIN_INTEGRITY_KEY_LENGTH = 32;

function key(): string | null {
  const k = process.env.INTEGRITY_KEY;
  return k && k.length >= MIN_INTEGRITY_KEY_LENGTH ? k : null;
}

export function integrityKeyConfigured(): boolean {
  return key() !== null;
}

/** Signature over `message`, or null when no key is configured (rows are then "unsigned"). */
export function integritySign(message: string): string | null {
  const k = key();
  return k ? createHmac('sha256', k).update(message, 'utf8').digest('hex') : null;
}

export type SignatureState = 'valid' | 'invalid' | 'unsigned' | 'unverifiable';

/**
 * 'unsigned'      — the row has no signature (written before a key was configured).
 * 'unverifiable'  — the row is signed but this server has no key to check it with.
 */
export function integrityCheck(message: string, signature: string | null | undefined): SignatureState {
  if (!signature) return 'unsigned';
  const expected = integritySign(message);
  if (!expected) return 'unverifiable';
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  return a.length === b.length && timingSafeEqual(a, b) ? 'valid' : 'invalid';
}
