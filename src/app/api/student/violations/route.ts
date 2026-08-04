import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { finalizeSubmission } from '@/lib/examSubmission';

const VALID_TYPES = [
  'FULLSCREEN_EXIT',
  'TAB_SWITCH',
  'WINDOW_BLUR',
  'VISIBILITY_HIDDEN',
  'DEVTOOLS_ATTEMPT',
  'CLIPBOARD_BLOCKED',
];

const DEDUPE_WINDOW_MS = 2000;

// Log an exam-mode violation. Also serves as the trigger point for the
// fullscreen-exit-threshold auto-submit — but the deadline/isSubmitted checks
// elsewhere (workspace route, ExecutionController) remain the real backstop,
// since this endpoint is inherently client-driven and can be skipped by a
// tampered/offline client.
export async function POST(req: Request) {
  const { errorResponse, session } = requireAuth(req, ['STUDENT']);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const { labId, type, details } = body;

    if (!labId || !type || !VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: 'Valid labId and violation type are required' }, { status: 400 });
    }

    const workspace = await prisma.labWorkspace.findFirst({
      where: { labId, studentId: session!.userId },
    });
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    const lab = await prisma.lab.findUnique({ where: { id: labId } });
    if (!lab) {
      return NextResponse.json({ error: 'Exam not found' }, { status: 404 });
    }

    if (workspace.isSubmitted) {
      return NextResponse.json({ logged: false, alreadySubmitted: true });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Coalesce near-simultaneous events (one Alt-Tab commonly fires blur +
      // visibilitychange + fullscreenchange together) into a single logged violation.
      const recent = await tx.examViolation.findFirst({
        where: {
          labId,
          studentId: session!.userId,
          type,
          createdAt: { gte: new Date(Date.now() - DEDUPE_WINDOW_MS) },
        },
      });

      if (recent) {
        const fullscreenExitCount = workspace.fullscreenExitCount;
        return { deduped: true, fullscreenExitCount, autoSubmit: false };
      }

      await tx.examViolation.create({
        data: { labId, studentId: session!.userId, type, details: details || null },
      });

      let fullscreenExitCount = workspace.fullscreenExitCount;
      if (type === 'FULLSCREEN_EXIT') {
        const updated = await tx.labWorkspace.update({
          where: { id: workspace.id },
          data: { fullscreenExitCount: { increment: 1 } },
        });
        fullscreenExitCount = updated.fullscreenExitCount;
      }

      let autoSubmit = false;
      if (type === 'FULLSCREEN_EXIT' && fullscreenExitCount >= lab.fullscreenExitThreshold) {
        await finalizeSubmission(tx, {
          workspaceId: workspace.id,
          labId,
          studentId: session!.userId,
          auto: true,
        });
        autoSubmit = true;
      }

      return { deduped: false, fullscreenExitCount, autoSubmit };
    });

    return NextResponse.json({ logged: !result.deduped, fullscreenExitCount: result.fullscreenExitCount, autoSubmit: result.autoSubmit });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
