import { PrismaClient, Prisma } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Single shared place that marks a workspace submitted and upserts the Submission
 * row. Used by the student-triggered submit_lab action, every lazy deadline check
 * (workspace route, ExecutionController), and the violation-threshold auto-submit
 * path — so they can never diverge (e.g. one path creating a duplicate Submission).
 * Idempotent: calling it on an already-submitted workspace is a safe no-op.
 */
export async function finalizeSubmission(
  db: Db,
  params: { workspaceId: string; labId: string; studentId: string; auto: boolean }
) {
  const { workspaceId, labId, studentId, auto } = params;

  const workspace = await db.labWorkspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) {
    throw new Error('Workspace not found');
  }

  if (workspace.isSubmitted) {
    const existing = await db.submission.findFirst({ where: { labId, studentId } });
    return existing;
  }

  const now = new Date();

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
