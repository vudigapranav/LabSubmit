import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { severityForType } from '@/lib/examIntegrity';

// Lightweight session-health signal, sent periodically while an exam is open. Updates
// lastActivityAt and detects a second concurrent session on the same attempt (e.g. the
// exam opened in another tab/browser) — logged as an integrity event, not blocked: an
// ordinary same-tab refresh reuses the same sessionId (see ExamGuard/sessionStorage), so
// this never misfires on a plain reload.
export async function POST(req: Request) {
  const { errorResponse, session } = requireAuth(req, ['STUDENT']);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const { labId, sessionId } = body;

    if (!labId || !sessionId) {
      return NextResponse.json({ error: 'labId and sessionId are required' }, { status: 400 });
    }

    const workspace = await prisma.labWorkspace.findFirst({
      where: { labId, studentId: session!.userId },
    });
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    if (workspace.isSubmitted) {
      return NextResponse.json({ ok: true, isSubmitted: true });
    }

    let duplicateSession = false;
    if (workspace.sessionId && workspace.sessionId !== sessionId) {
      duplicateSession = true;
      await prisma.examViolation.create({
        data: {
          labId,
          studentId: session!.userId,
          type: 'DUPLICATE_SESSION',
          severity: severityForType('DUPLICATE_SESSION'),
          details: 'Exam opened in another tab/browser while a session was already active',
        },
      });
    }

    await prisma.labWorkspace.update({
      where: { id: workspace.id },
      data: {
        lastActivityAt: new Date(),
        // Only claim the session slot if it's currently unset — a duplicate session is
        // logged, not evicted, so the original tab keeps working uninterrupted.
        ...(workspace.sessionId ? {} : { sessionId }),
      },
    });

    return NextResponse.json({ ok: true, duplicateSession });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
