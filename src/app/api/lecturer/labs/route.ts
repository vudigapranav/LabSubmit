import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getExamStatus, serializeAllowedLanguages } from '@/lib/examTiming';
import { defaultSectionConfig, normalizeSectionConfig, NormalizedSection } from '@/lib/answerSheet';

// The lecturer's answer-sheet format, resolved for a brand-new exam. An empty or absent
// payload falls back to the standard unified format rather than to no sheet at all, so an
// exam is never created without one.
function sectionsForCreate(input: unknown) {
  const normalized = normalizeSectionConfig(input);
  const sections: NormalizedSection[] =
    normalized.length > 0
      ? normalized
      : defaultSectionConfig().map((s) => ({
          key: s.key,
          label: s.label,
          order: s.order,
          enabled: s.enabled,
          required: s.required,
          maxMarks: s.maxMarks,
          contentSource: s.contentSource,
        }));

  return sections.map((s) => ({
    key: s.key,
    label: s.label,
    order: s.order,
    enabled: s.enabled,
    required: s.required,
    maxMarks: s.maxMarks,
    contentSource: s.contentSource,
  }));
}

// Reconfiguring the format of an exam that students may already have answered: sections
// are matched by key and UPDATED IN PLACE, never dropped and recreated, so a section that
// is merely switched off keeps the answers already written into it (and gets them back if
// the lecturer switches it on again). Only a key the lecturer removed from the format
// entirely is deleted, which cascades its responses — the one genuinely destructive case,
// and an explicit one.
async function syncAnswerSheetSections(labId: string, input: unknown) {
  const sections = normalizeSectionConfig(input);
  if (sections.length === 0) return;

  const keptKeys = sections.map((s) => s.key);

  await prisma.$transaction([
    prisma.answerSheetSection.deleteMany({ where: { labId, key: { notIn: keptKeys } } }),
    ...sections.map((s) =>
      prisma.answerSheetSection.upsert({
        where: { labId_key: { labId, key: s.key } },
        create: {
          labId,
          key: s.key,
          label: s.label,
          order: s.order,
          enabled: s.enabled,
          required: s.required,
          maxMarks: s.maxMarks,
          contentSource: s.contentSource,
        },
        update: {
          label: s.label,
          order: s.order,
          enabled: s.enabled,
          required: s.required,
          maxMarks: s.maxMarks,
          contentSource: s.contentSource,
        },
      })
    ),
  ]);
}

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
        answerSheetSections: { orderBy: { order: 'asc' } },
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
      requireDesktopDevice = true,
      answerSheetSections,
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
        requireDesktopDevice: Boolean(requireDesktopDevice),
        // A new exam always gets the unified answer sheet — the lecturer's own layout if
        // they configured one in the create form, otherwise the standard default format.
        answerSheetSections: { create: sectionsForCreate(answerSheetSections) },
      },
      include: { branch: true, subject: true, answerSheetSections: { orderBy: { order: 'asc' } } },
    });

    return NextResponse.json({ message: 'Exam created successfully', lab });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const { errorResponse, session } = requireAuth(req, ['LECTURER', 'ADMIN']);
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
      requireDesktopDevice,
      answerSheetSections,
    } = body;

    if (!id) {
      return NextResponse.json({ error: 'Exam ID is required' }, { status: 400 });
    }

    const existing = await prisma.lab.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Exam not found' }, { status: 404 });
    }
    if (session!.role === 'LECTURER' && existing.lecturerId !== session!.userId) {
      return NextResponse.json({ error: 'You do not have access to this exam.' }, { status: 403 });
    }

    const effectiveExamModeEnabled = examModeEnabled !== undefined ? Boolean(examModeEnabled) : undefined;
    if (effectiveExamModeEnabled && endTime === undefined && !existing.endTime) {
      return NextResponse.json({ error: 'An end time is required for exam-mode exams' }, { status: 400 });
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
        ...(requireDesktopDevice !== undefined && { requireDesktopDevice: Boolean(requireDesktopDevice) }),
      },
      include: { branch: true, subject: true },
    });

    if (answerSheetSections !== undefined) {
      await syncAnswerSheetSections(id, answerSheetSections);
    }

    const labWithSections = await prisma.lab.findUnique({
      where: { id },
      include: { branch: true, subject: true, answerSheetSections: { orderBy: { order: 'asc' } } },
    });

    return NextResponse.json({ message: 'Exam updated successfully', lab: labWithSections ?? lab });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const { errorResponse, session } = requireAuth(req, ['LECTURER', 'ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Exam ID is required' }, { status: 400 });
    }

    const existing = await prisma.lab.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Exam not found' }, { status: 404 });
    }
    if (session!.role === 'LECTURER' && existing.lecturerId !== session!.userId) {
      return NextResponse.json({ error: 'You do not have access to this exam.' }, { status: 403 });
    }

    await prisma.lab.delete({
      where: { id },
    });

    return NextResponse.json({ message: 'Exam deleted successfully' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
