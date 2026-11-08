import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { evaluateSectionMarks, gradableSections, validateFlatMarks, MAX_REMARK_LENGTH } from '@/lib/answerSheet';

export async function POST(req: Request) {
  const { errorResponse, session } = requireAuth(req, ['LECTURER', 'ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    // isPublished is deliberately NOT read from the body. Whether a saved evaluation is
    // visible to the student is a property of the exam's release state, decided below from
    // the database. The old behaviour trusted a client flag that the lecturer UI hardcoded
    // to true, which published every mark the instant it was typed.
    const { submissionId, marks, remarks, status, sectionMarks } = body;

    if (!submissionId || !status) {
      return NextResponse.json({ error: 'Submission ID and status are required' }, { status: 400 });
    }

    const validStatuses = ['APPROVED', 'REJECTED', 'NEEDS_CORRECTION', 'PENDING'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid evaluation status' }, { status: 400 });
    }
    if (remarks !== undefined && remarks !== null && (typeof remarks !== 'string' || remarks.length > MAX_REMARK_LENGTH * 2)) {
      return NextResponse.json({ error: `Remarks must be text of at most ${MAX_REMARK_LENGTH * 2} characters.` }, { status: 400 });
    }

    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: { workspace: true, lab: { include: { answerSheetSections: true } } },
    });

    if (!submission) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }
    if (session!.role === 'LECTURER' && submission.lab.lecturerId !== session!.userId) {
      return NextResponse.json({ error: 'You do not have access to this submission.' }, { status: 403 });
    }

    // Publication is derived, never supplied. Before the exam's results are released a
    // saved grade stays private, so the lecturer can mark, review and change marks freely.
    // Once the cohort has been released, a grade saved for a late or re-marked submission
    // is published immediately — withholding one student's mark after their classmates
    // already have theirs is the confusing case, not the safe one.
    const resultsReleased = submission.lab.resultsReleasedAt !== null;

    const common = {
      status,
      remarks: remarks !== undefined ? remarks : submission.remarks,
      isPublished: resultsReleased,
      evaluatedAt: new Date(),
      evaluatorId: session!.userId,
    };

    let updatedSubmission;

    if (sectionMarks !== undefined) {
      // Section-wise: the server computes the total from the section marks. Any flat `marks`
      // in the same request is ignored — the total cannot disagree with its parts.
      if (!Array.isArray(sectionMarks)) {
        return NextResponse.json({ error: 'sectionMarks must be a list.' }, { status: 400 });
      }
      if (gradableSections(submission.lab.answerSheetSections).length === 0) {
        return NextResponse.json({ error: 'This examination has no separately marked sections.' }, { status: 400 });
      }
      const result = evaluateSectionMarks(submission.lab.answerSheetSections, sectionMarks);
      if (result.errors.length > 0) {
        return NextResponse.json({ error: result.errors.join(' '), errors: result.errors }, { status: 400 });
      }

      // Merge with section marks already saved, so a partial save never clears others.
      const existing = await prisma.sectionEvaluation.findMany({ where: { submissionId } });
      const merged = new Map(existing.map((e) => [e.sectionId, { sectionId: e.sectionId, marks: e.marks, remarks: e.remarks }]));
      result.entries.forEach((e) => merged.set(e.sectionId, e));
      const rollup = evaluateSectionMarks(submission.lab.answerSheetSections, Array.from(merged.values()));

      // A total built from some sections must never reach a student. Release publishes every
      // submission with a final (non-PENDING) status, and saves after release publish at once,
      // so a final status requires every weighted section to be marked. Partial marks are saved
      // as PENDING, which release does not count as graded.
      if (status !== 'PENDING' && !rollup.complete) {
        return NextResponse.json(
          { error: 'Every marked section needs a mark before a final status can be saved. Save as Pending to keep partial marks.' },
          { status: 400 }
        );
      }

      // A blank, unremarked section gets no row unless one already exists (then it is
      // updated, which is how a lecturer clears a mark) — rows mean "this was evaluated".
      const existingIds = new Set(existing.map((e) => e.sectionId));
      const toWrite = result.entries.filter((e) => e.marks !== null || e.remarks !== null || existingIds.has(e.sectionId));

      // One transaction: the section rows and the rolled-up total are never out of step.
      const results = await prisma.$transaction([
        ...toWrite.map((e) =>
          prisma.sectionEvaluation.upsert({
            where: { submissionId_sectionId: { submissionId, sectionId: e.sectionId } },
            create: { submissionId, sectionId: e.sectionId, marks: e.marks, remarks: e.remarks },
            update: { marks: e.marks, remarks: e.remarks },
          })
        ),
        prisma.submission.update({
          where: { id: submissionId },
          data: { ...common, marks: rollup.total, maxMarks: rollup.maxTotal },
        }),
      ]);
      updatedSubmission = results[results.length - 1];
    } else {
      // Original single-mark path, now validated: a mark outside 0..maxMarks, or not a number,
      // used to be written straight through.
      if (marks !== undefined && marks !== null && marks !== '') {
        const flat = validateFlatMarks(marks, submission.maxMarks);
        if (flat.error) return NextResponse.json({ error: flat.error }, { status: 400 });
        updatedSubmission = await prisma.submission.update({ where: { id: submissionId }, data: { ...common, marks: flat.marks } });
      } else {
        updatedSubmission = await prisma.submission.update({ where: { id: submissionId }, data: common });
      }
    }

    // Auditable grading history: what changed, by whom, before → after.
    const before = { status: submission.status, marks: submission.marks, maxMarks: submission.maxMarks, isPublished: submission.isPublished };
    // Re-read what was actually committed rather than trusting the in-memory result.
    const saved = await prisma.submission.findUnique({ where: { id: submissionId } });
    const after = saved ? { status: saved.status, marks: saved.marks, maxMarks: saved.maxMarks, isPublished: saved.isPublished } : null;
    await recordAudit({
      action: 'GRADE_SAVED', category: 'GRADING', actorId: session!.userId, actorRole: session!.role,
      targetType: 'Submission', targetId: submissionId,
      metadata: { labId: submission.labId, studentId: submission.studentId, before, after, sectionMarks: sectionMarks ?? null },
    });
    if (after && before.isPublished !== after.isPublished) {
      await recordAudit({
        action: after.isPublished ? 'RESULT_PUBLISHED' : 'RESULT_WITHDRAWN', category: 'GRADING', actorId: session!.userId, actorRole: session!.role,
        targetType: 'Submission', targetId: submissionId, metadata: { labId: submission.labId, studentId: submission.studentId, marks: after.marks, maxMarks: after.maxMarks },
      });
    }

    // If returned for corrections, reopen student workspace
    if (status === 'NEEDS_CORRECTION') {
      await prisma.labWorkspace.update({
        where: { id: submission.workspaceId },
        data: { isSubmitted: false },
      });
    }

    return NextResponse.json({
      message: resultsReleased
        ? 'Evaluation saved and visible to the student — results for this exam are released'
        : 'Evaluation saved. It stays private until you release results for this exam.',
      resultsReleased,
      submission: updatedSubmission,
    });
  } catch (error) {
    console.error('[evaluate] POST failed:', error);
    return NextResponse.json({ error: 'Could not save the evaluation.' }, { status: 500 });
  }
}
