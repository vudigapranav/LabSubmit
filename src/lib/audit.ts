// Tamper-evident audit log. Server-only (Prisma, node:crypto).
//
// Every security-sensitive action appends one AuditEvent. Each row's hash covers its content
// AND the previous row's hash (a hash chain), so altering, inserting into or deleting from the
// middle of the log breaks verification from that row on. This is tamper-EVIDENT: an attacker
// with full database write access could rewrite the whole chain from the point they changed —
// to detect that too, periodically record the latest hash somewhere they cannot write
// (see AUDIT_LOGGING_DESIGN.md, "anchoring").
import { createHash } from 'crypto';
import { prisma } from './db';

export type AuditCategory = 'AUTH' | 'ADMIN' | 'EXAM' | 'SUBMISSION' | 'GRADING';

export interface AuditInput {
  action: string;
  category: AuditCategory;
  actorId?: string | null;
  actorRole?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

export const GENESIS_HASH = '0'.repeat(64);

// Keys whose values must never reach the log, at any depth.
const SECRET_KEY = /pass(word)?|token|secret|authorization|cookie|hash(ed)?Password/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // JSON storage drops undefined keys; drop them here too, or the hash computed before
      // storage would include a key the stored row no longer has (false "tampered" alarm).
      if (v === undefined) continue;
      out[k] = SECRET_KEY.test(k) ? '[REDACTED]' : redact(v);
    }
    return out;
  }
  return value;
}

// Deterministic JSON (sorted keys) so the same content always hashes the same.
function stable(value: unknown): string {
  // Match how JSON storage serialises a Date (ISO string), or a Date in metadata would hash
  // as "{}" before storage and as its ISO string after.
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export interface AuditRowLike {
  seq: number;
  at: Date;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  category: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  ip: string | null;
  prevHash: string;
  hash: string;
}

export function computeAuditHash(prevHash: string, row: Omit<AuditRowLike, 'hash' | 'prevHash'>): string {
  return createHash('sha256')
    .update(
      prevHash +
        stable({
          seq: row.seq,
          at: row.at.toISOString(),
          actorId: row.actorId,
          actorRole: row.actorRole,
          action: row.action,
          category: row.category,
          targetType: row.targetType,
          targetId: row.targetId,
          metadata: row.metadata ?? {},
          ip: row.ip,
        })
    )
    .digest('hex');
}

/** Walks rows in sequence order; returns the first row whose link or content does not verify. */
export function verifyAuditRows(rows: AuditRowLike[]): { ok: boolean; checked: number; brokenAtSeq: number | null; reason?: string } {
  let prev = GENESIS_HASH;
  for (const row of rows) {
    if (row.prevHash !== prev) return { ok: false, checked: rows.length, brokenAtSeq: row.seq, reason: 'link to previous row does not match (row deleted, inserted or reordered)' };
    if (computeAuditHash(row.prevHash, row) !== row.hash) return { ok: false, checked: rows.length, brokenAtSeq: row.seq, reason: 'row content does not match its hash (row edited)' };
    prev = row.hash;
  }
  return { ok: true, checked: rows.length, brokenAtSeq: null };
}

export async function verifyAuditChain() {
  const rows = (await prisma.auditEvent.findMany({ orderBy: { seq: 'asc' } })) as AuditRowLike[];
  return verifyAuditRows(rows);
}

// Arbitrary constant: the advisory-lock key that serialises appends, so two concurrent events
// can never both link to the same previous row (which would fork the chain).
const AUDIT_LOCK_KEY = 7_402_011;

/**
 * Appends one event. Never throws: an audit write must not turn a login or a submission into
 * an error. Failures are logged loudly instead (see AUDIT_LOGGING_DESIGN.md for the trade-off).
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`;
      const last = await tx.auditEvent.findFirst({ orderBy: { seq: 'desc' }, select: { seq: true, hash: true } });
      const prevHash = last?.hash ?? GENESIS_HASH;
      // seq is assigned explicitly (not by the sequence) so it can be part of the hash; the
      // advisory lock makes "last + 1" safe.
      const row = {
        seq: (last?.seq ?? 0) + 1,
        at: new Date(),
        actorId: input.actorId ?? null,
        actorRole: input.actorRole ?? null,
        action: input.action,
        category: input.category,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        metadata: (redact(input.metadata ?? {}) ?? {}) as Record<string, unknown>,
        ip: input.ip ?? null,
      };
      await tx.auditEvent.create({ data: { ...row, metadata: row.metadata as object, prevHash, hash: computeAuditHash(prevHash, row) } });
    });
  } catch (err) {
    console.error('[AUDIT] Failed to record audit event', input.action, err instanceof Error ? err.message : err);
  }
}

/** Client address for audit records (first X-Forwarded-For hop; see rateLimit.ts caveat). */
export function requestIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  return fwd ? fwd.split(',')[0].trim() : req.headers.get('x-real-ip');
}
