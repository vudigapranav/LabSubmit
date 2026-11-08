import { PrismaClient, Prisma } from '@prisma/client';
import { severityForType } from './examIntegrity';
import { getEffectiveDeadline } from './examTiming';
import { recordAudit } from './audit';
import { canonicalAnswers, canonicalFiles, signSnapshotHash, snapshotHash, type SnapshotAnswer, type SnapshotFile } from './submissionSnapshot';

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
  const now = new Date(); // the server's clock is the only clock that counts

  // Atomic claim. Exactly one caller can flip isSubmitted false→true; every concurrent or
  // repeated caller (double-click, client retry, a manual submit racing the timeout or the
  // integrity threshold) gets count 0 and the existing submission back. The previous
  // read-then-write let two simultaneous requests both see "not submitted" and both create
  // a Submission.
  const claim = await db.labWorkspace.updateMany({
    where: { id: workspaceId, labId, studentId, isSubmitted: false },
    data: { isSubmitted: true, submittedAt: now, autoSubmitted: auto },
  });
  if (claim.count === 0) {
    const exists = await db.labWorkspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
    if (!exists) throw new Error('Workspace not found');
    return db.submission.findFirst({ where: { labId, studentId } });
  }

  if (auto && reason === 'TIMEOUT') {
    await db.examViolation.create({
      data: { labId, studentId, type: 'EXAM_TIMEOUT', severity: severityForType('EXAM_TIMEOUT'), details: 'Auto-submitted: exam deadline reached' },
    });
  }

  const existing = await db.submission.findFirst({ where: { labId, studentId } });
  const submission = existing
    ? await db.submission.update({ where: { id: existing.id }, data: { workspaceId, status: 'PENDING', submittedAt: now } })
    : await db.submission.create({ data: { labId, studentId, workspaceId, status: 'PENDING', submittedAt: now } });

  // Immutable snapshot of exactly what was handed in. Only the claim winner reaches here, and
  // a resubmission needs the lecturer to reopen the attempt first, so versions are sequential.
  const [workspace, lab, priorVersions] = await Promise.all([
    db.labWorkspace.findUnique({
      where: { id: workspaceId },
      include: { files: true, answerSheetResponses: { include: { section: true } } },
    }),
    db.lab.findUnique({ where: { id: labId } }),
    db.submissionSnapshot.count({ where: { submissionId: submission.id } }),
  ]);
  const version = priorVersions + 1;
  const files: SnapshotFile[] = (workspace?.files || []).map((f) => ({ filename: f.filename, language: f.language, content: f.content }));
  const answers: SnapshotAnswer[] = (workspace?.answerSheetResponses || []).map((r) => ({
    sectionKey: r.section.key,
    label: r.section.label,
    content: r.content,
  }));
  // Saves are refused after the deadline, so the CONTENT is always as of the deadline at the
  // latest. onTime records whether the hand-in itself happened by then; the deadline
  // auto-submit is on time by definition (it captures the deadline state).
  const deadline = lab && workspace ? getEffectiveDeadline(lab, workspace) : null;
  const onTime = reason === 'TIMEOUT' || !deadline || now.getTime() <= deadline.getTime();

  const snapshotHashValue = snapshotHash({ submissionId: submission.id, labId, studentId, version, submittedAt: now }, files, answers);
  await db.submissionSnapshot.create({
    data: {
      submissionId: submission.id,
      version,
      files: canonicalFiles(files) as unknown as Prisma.InputJsonValue,
      answers: canonicalAnswers(answers) as unknown as Prisma.InputJsonValue,
      contentHash: snapshotHashValue,
      signature: signSnapshotHash(snapshotHashValue),
      submittedAt: now,
      auto,
      reason: reason ?? null,
      onTime,
      sessionId: workspace?.sessionId ?? null,
    },
  });

  await recordAudit({
    action: 'SUBMISSION_FINALIZED', category: 'SUBMISSION', actorId: auto ? null : studentId, actorRole: auto ? 'SYSTEM' : 'STUDENT',
    targetType: 'Submission', targetId: submission.id,
    metadata: { labId, studentId, version, contentHash: snapshotHashValue, auto, reason: reason ?? null, onTime, submittedAt: now },
  });

  return submission;
}
