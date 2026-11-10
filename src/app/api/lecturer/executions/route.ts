import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// Faculty-only: the recorded program runs behind one submission, newest first. Lets an
// evaluator see what the student actually executed during the attempt, and check the
// Output section against it. Students have no access — this is evaluation evidence.
export async function GET(req: Request) {
  const { errorResponse, session } = await requireAuth(req, ['LECTURER', 'ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const submissionId = new URL(req.url).searchParams.get('submissionId');
    if (!submissionId) {
      return NextResponse.json({ error: 'submissionId is required' }, { status: 400 });
    }

    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      select: { workspaceId: true, lab: { select: { lecturerId: true } } },
    });
    // Same response for "does not exist" and "not yours", so ids cannot be probed.
    if (!submission || (session!.role === 'LECTURER' && submission.lab.lecturerId !== session!.userId)) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }

    const runs = await prisma.executionRecord.findMany({
      where: { workspaceId: submission.workspaceId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        filename: true,
        language: true,
        stdin: true,
        stdout: true,
        exitCode: true,
        durationMs: true,
        compileFailed: true,
        files: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ runs });
  } catch (error) {
    console.error('[executions] GET failed:', error);
    return NextResponse.json({ error: 'Could not load run history.' }, { status: 500 });
  }
}
