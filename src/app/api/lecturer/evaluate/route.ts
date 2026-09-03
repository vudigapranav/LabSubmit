import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(req: Request) {
  const { errorResponse, session } = requireAuth(req, ['LECTURER', 'ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    // isPublished is deliberately NOT read from the body. Whether a saved evaluation is
    // visible to the student is a property of the exam's release state, decided below from
    // the database. The old behaviour trusted a client flag that the lecturer UI hardcoded
    // to true, which published every mark the instant it was typed.
    const { submissionId, marks, remarks, status } = body;

    if (!submissionId || !status) {
      return NextResponse.json({ error: 'Submission ID and status are required' }, { status: 400 });
    }

    const validStatuses = ['APPROVED', 'REJECTED', 'NEEDS_CORRECTION', 'PENDING'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid evaluation status' }, { status: 400 });
    }

    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: { workspace: true, lab: true },
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

    const updatedSubmission = await prisma.submission.update({
      where: { id: submissionId },
      data: {
        status,
        marks: marks !== undefined && marks !== null ? parseFloat(marks) : submission.marks,
        remarks: remarks !== undefined ? remarks : submission.remarks,
        isPublished: resultsReleased,
        evaluatedAt: new Date(),
        evaluatorId: session!.userId,
      },
    });

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
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
