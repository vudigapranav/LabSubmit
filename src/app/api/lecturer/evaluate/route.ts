import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(req: Request) {
  const { errorResponse, session } = requireAuth(req, ['LECTURER', 'ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const { submissionId, marks, remarks, status, isPublished } = body;

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

    // Update submission evaluation
    const updatedSubmission = await prisma.submission.update({
      where: { id: submissionId },
      data: {
        status,
        marks: marks !== undefined && marks !== null ? parseFloat(marks) : submission.marks,
        remarks: remarks !== undefined ? remarks : submission.remarks,
        isPublished: isPublished !== undefined ? Boolean(isPublished) : submission.isPublished,
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
      message: 'Evaluation saved successfully',
      submission: updatedSubmission,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
