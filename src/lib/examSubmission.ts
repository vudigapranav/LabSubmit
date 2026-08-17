import { PrismaClient, Prisma } from '@prisma/client';
import { severityForType } from './examIntegrity';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Single shared place that marks a workspace submitted and upserts the Submission
 * row. Used by the student-triggered submit_lab action, every lazy deadline check
 * (workspace route, ExecutionController), and the violation-threshold auto-submit
 * path — so they can never diverge (e.g. one path creating a duplicate Submission).
 * Idempotent: calling it on an already-submitted workspace is a safe no-op.
 *
 * `reason: 'TIMEOUT'` additionally logs an EXAM_TIMEOUT integrity event here (not at
 * each call site) so every deadline-triggered auto-submit — regardless of which of the
 * two lazy-check call sites caught it — reliably gets the same audit trail entry.
 */
export async function finalizeSubmission(
  db: Db,
  params: { workspaceId: string; labId: string; studentId: string; auto: boolean; reason?: 'TIMEOUT' | 'FULLSCREEN_THRESHOLD' }
) {
  const { workspaceId, labId, studentId, auto, reason } = params;

  const workspace = await db.labWorkspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) {
    throw new Error('Workspace not found');
  }

  if (workspace.isSubmitted) {
    const existing = await db.submission.findFirst({ where: { labId, studentId } });
    return existing;
  }

  const now = new Date();

  if (auto && reason === 'TIMEOUT') {
    await db.examViolation.create({
      data: { labId, studentId, type: 'EXAM_TIMEOUT', severity: severityForType('EXAM_TIMEOUT'), details: 'Auto-submitted: exam deadline reached' },
    });
  }

  await db.labWorkspace.update({
    where: { id: workspaceId },
    data: { isSubmitted: true, submittedAt: now, autoSubmitted: auto },
  });

  const existing = await db.submission.findFirst({ where: { labId, studentId } });

  if (existing) {
    return db.submission.update({
      where: { id: existing.id },
      data: { workspaceId, status: 'PENDING', submittedAt: now },
    });
  }

  return db.submission.create({
    data: { labId, studentId, workspaceId, status: 'PENDING' },
  });
}
