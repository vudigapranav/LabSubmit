import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getExamStatus, serializeAllowedLanguages } from '@/lib/examTiming';

export async function GET(req: Request) {
  const { errorResponse, session } = requireAuth(req, ['LECTURER', 'ADMIN', 'STUDENT']);
  if (errorResponse) return errorResponse;

  try {
    const { searchParams } = new URL(req.url);
    const year = searchParams.get('year');
    const branchId = searchParams.get('branchId');
    const subjectId = searchParams.get('subjectId');

    const whereClause: any = {};

    if (session!.role === 'LECTURER') {
      whereClause.lecturerId = session!.userId;
    }

    if (year) {
      whereClause.year = parseInt(year);
    }
    if (branchId) {
      whereClause.branchId = branchId;
    }
    if (subjectId) {
      whereClause.subjectId = subjectId;
    }

    const labs = await prisma.lab.findMany({
      where: whereClause,
      include: {
        branch: true,
        subject: true,
        lecturer: { select: { name: true, email: true } },
        _count: { select: { submissions: true, workspaces: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Attach computed exam status + appeared/submitted/pending counts for the faculty dashboard.
    const labsWithStats = await Promise.all(
      labs.map(async (lab) => {
        const [startedCount, submittedCount, violationCount] = await Promise.all([
          prisma.labWorkspace.count({ where: { labId: lab.id, startedAt: { not: null } } }),
          prisma.labWorkspace.count({ where: { labId: lab.id, isSubmitted: true } }),
          prisma.examViolation.count({ where: { labId: lab.id } }),
        ]);

        return {
          ...lab,
          status: getExamStatus(lab),
          appearedCount: startedCount,
          submittedCount,
          pendingCount: Math.max(startedCount - submittedCount, 0),
          violationCount,
        };
      })
    );

    return NextResponse.json({ labs: labsWithStats });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { errorResponse, session } = requireAuth(req, ['LECTURER', 'ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const {
      title,
      description,
      problemStatement,
      year,
      branchId,
      subjectId,
      dueDate,
      allowCopy = false,
      allowPaste = false,
      allowCut = false,
      allowRightClick = false,
      allowDragDrop = false,
      examDate,
      startTime,
      endTime,
      durationMinutes,
      allowedLanguages,
      examModeEnabled = true,
      isPublished = false,
      fullscreenExitThreshold = 3,
    } = body;

    if (!title || !problemStatement || !year || !branchId || !subjectId) {
      return NextResponse.json({ error: 'Title, problem statement, year, branch, and subject are required' }, { status: 400 });
    }

    if (examModeEnabled && !endTime) {
      return NextResponse.json({ error: 'An end time is required for exam-mode exams' }, { status: 400 });
    }

    const lab = await prisma.lab.create({
      data: {
        title: title.trim(),
        description: description ? description.trim() : '',
        problemStatement: problemStatement.trim(),
        year: parseInt(year),
        branchId,
        subjectId,
        lecturerId: session!.userId,
        dueDate: dueDate ? new Date(dueDate) : null,
        allowCopy: Boolean(allowCopy),
        allowPaste: Boolean(allowPaste),
        allowCut: Boolean(allowCut),
        allowRightClick: Boolean(allowRightClick),
        allowDragDrop: Boolean(allowDragDrop),
        examDate: examDate ? new Date(examDate) : null,
        startTime: startTime ? new Date(startTime) : null,
        endTime: endTime ? new Date(endTime) : null,
        durationMinutes: durationMinutes ? parseInt(durationMinutes) : null,
        allowedLanguages: serializeAllowedLanguages(Array.isArray(allowedLanguages) ? allowedLanguages : []),
        examModeEnabled: Boolean(examModeEnabled),
        isPublished: Boolean(isPublished),
        fullscreenExitThreshold: parseInt(fullscreenExitThreshold) || 3,
      },
      include: { branch: true, subject: true },
    });

    return NextResponse.json({ message: 'Exam created successfully', lab });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const { errorResponse } = requireAuth(req, ['LECTURER', 'ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const {
      id,
      title,
      description,
      problemStatement,
      year,
      branchId,
      subjectId,
      dueDate,
      allowCopy,
      allowPaste,
      allowCut,
      allowRightClick,
      allowDragDrop,
      examDate,
      startTime,
      endTime,
      durationMinutes,
      allowedLanguages,
      examModeEnabled,
      isPublished,
      fullscreenExitThreshold,
    } = body;

    if (!id) {
      return NextResponse.json({ error: 'Exam ID is required' }, { status: 400 });
    }

    const effectiveExamModeEnabled = examModeEnabled !== undefined ? Boolean(examModeEnabled) : undefined;
    if (effectiveExamModeEnabled && endTime === undefined) {
      const existing = await prisma.lab.findUnique({ where: { id } });
      if (!existing?.endTime) {
        return NextResponse.json({ error: 'An end time is required for exam-mode exams' }, { status: 400 });
      }
    }

    const lab = await prisma.lab.update({
      where: { id },
      data: {
        ...(title && { title: title.trim() }),
        ...(description !== undefined && { description: description.trim() }),
        ...(problemStatement && { problemStatement: problemStatement.trim() }),
        ...(year && { year: parseInt(year) }),
        ...(branchId && { branchId }),
        ...(subjectId && { subjectId }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        ...(allowCopy !== undefined && { allowCopy: Boolean(allowCopy) }),
        ...(allowPaste !== undefined && { allowPaste: Boolean(allowPaste) }),
        ...(allowCut !== undefined && { allowCut: Boolean(allowCut) }),
        ...(allowRightClick !== undefined && { allowRightClick: Boolean(allowRightClick) }),
        ...(allowDragDrop !== undefined && { allowDragDrop: Boolean(allowDragDrop) }),
        ...(examDate !== undefined && { examDate: examDate ? new Date(examDate) : null }),
        ...(startTime !== undefined && { startTime: startTime ? new Date(startTime) : null }),
        ...(endTime !== undefined && { endTime: endTime ? new Date(endTime) : null }),
        ...(durationMinutes !== undefined && { durationMinutes: durationMinutes ? parseInt(durationMinutes) : null }),
        ...(allowedLanguages !== undefined && {
          allowedLanguages: serializeAllowedLanguages(Array.isArray(allowedLanguages) ? allowedLanguages : []),
        }),
        ...(examModeEnabled !== undefined && { examModeEnabled: Boolean(examModeEnabled) }),
        ...(isPublished !== undefined && { isPublished: Boolean(isPublished) }),
        ...(fullscreenExitThreshold !== undefined && { fullscreenExitThreshold: parseInt(fullscreenExitThreshold) || 3 }),
      },
      include: { branch: true, subject: true },
    });

    return NextResponse.json({ message: 'Exam updated successfully', lab });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const { errorResponse } = requireAuth(req, ['LECTURER', 'ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Exam ID is required' }, { status: 400 });
    }

    await prisma.lab.delete({
      where: { id },
    });

    return NextResponse.json({ message: 'Exam deleted successfully' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
