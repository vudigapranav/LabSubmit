import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { recordAudit, verifyAuditChain } from '@/lib/audit';

// Admin-only view of the audit trail.
//   ?action= &category= &actorId= &targetId= &from=ISO &to=ISO  — filters
//   ?limit= (≤500, default 100) &before=<seq>                     — newest-first paging
//   ?format=csv                                                   — export (itself audited)
//   ?verify=1                                                     — walk and verify the whole hash chain
export async function GET(req: Request) {
  const { errorResponse, session } = await requireAuth(req, ['ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const q = new URL(req.url).searchParams;

    if (q.get('verify') === '1') {
      return NextResponse.json({ verification: await verifyAuditChain() });
    }

    const where: Record<string, unknown> = {};
    for (const key of ['action', 'category', 'actorId', 'targetId'] as const) {
      const v = q.get(key);
      if (v) where[key] = v;
    }
    const from = q.get('from') ? new Date(q.get('from')!) : null;
    const to = q.get('to') ? new Date(q.get('to')!) : null;
    if ((from && isNaN(from.getTime())) || (to && isNaN(to.getTime()))) {
      return NextResponse.json({ error: 'from/to must be ISO dates' }, { status: 400 });
    }
    if (from || to) where.at = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    const before = Number(q.get('before'));
    if (Number.isInteger(before) && before > 0) where.seq = { lt: before };
    const limit = Math.min(Math.max(Number(q.get('limit')) || 100, 1), 500);

    const events = await prisma.auditEvent.findMany({ where, orderBy: { seq: 'desc' }, take: limit });

    if (q.get('format') === 'csv') {
      await recordAudit({
        action: 'AUDIT_EXPORTED', category: 'ADMIN', actorId: session!.userId, actorRole: session!.role,
        metadata: { filters: Object.fromEntries(q.entries()), rows: events.length },
      });
      const cell = (v: unknown) => {
        const s = v === null || v === undefined ? '' : typeof v === 'string' ? v : v instanceof Date ? v.toISOString() : JSON.stringify(v);
        // Quote every cell; neutralise spreadsheet formula injection (=, +, -, @ at the start).
        return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
      };
      const header = ['seq', 'at', 'action', 'category', 'actorId', 'actorRole', 'targetType', 'targetId', 'ip', 'metadata', 'prevHash', 'hash'];
      const lines = [header.join(','), ...events.map((e) => header.map((h) => cell((e as Record<string, unknown>)[h])).join(','))];
      return new NextResponse(lines.join('\n'), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="labsubmit-audit.csv"' },
      });
    }

    return NextResponse.json({ events, nextBefore: events.length === limit ? events[events.length - 1].seq : null });
  } catch (error) {
    console.error('[/api/admin/audit]', error);
    return NextResponse.json({ error: 'Could not load the audit log.' }, { status: 500 });
  }
}
