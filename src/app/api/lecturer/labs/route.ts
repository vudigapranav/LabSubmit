import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getExamStatus, serializeAllowedLanguages } from '@/lib/examTiming';
import { defaultSectionConfig, normalizeSectionConfig, NormalizedSection } from '@/lib/answerSheet';
import {
  ARCHIVE_EFFECTS,
  ARCHIVE_PRESERVES,
  EXAM_ADMIN_ACTIONS,
  ExamActivity,
  deletionRefusalMessage,
  describeActivity,
  hasStudentActivity,
} from '@/lib/examLifecycle';

/**
 * Everything a student could have created under this exam, counted in one place so the
 * DELETE guard and the lecturer's dialog agree. Counts only — never a name or a roll
 * number: the lecturer needs to know work exists, not whose it is, to choose between
 * deleting and archiving.
 */
async function loadExamActivity(labId: string): Promise<ExamActivity> {
  const [startedAttempts, submissions, gradedSubmissions, violations, files, answerSheetResponses] =
    await Promise.all([
      prisma.labWorkspace.count({ where: { labId, startedAt: { not: null } } }),
      prisma.submission.count({ where: { labId } }),
      prisma.submission.count({ where: { labId, marks: { not: null } } }),
      prisma.examViolation.count({ where: { labId } }),
      prisma.labFile.count({ where: { workspace: { labId } } }),
      prisma.answerSheetResponse.count({ where: { workspace: { labId } } }),
    ]);

  return { startedAttempts, submissions, gradedSubmissions, violations, files, answerSheetResponses };
}

/**
 * Ownership guard, matching the convention already used by the question-set routes: a
 * LECTURER may only act on their own exams; an ADMIN may act on any.
 */
async function assertLabAccess(labId: string, session: { role: string; userId: string }) {
  const lab = await prisma.lab.findUnique({ where: { id: labId } });
  if (!lab) return { error: NextResponse.json({ error: 'Exam not found' }, { status: 404 }), lab: null };
  if (session.role === 'LECTURER' && lab.lecturerId !== session.userId) {
    return { error: NextResponse.json({ error: 'You do not have access to this exam.' }, { status: 403 }), lab: null };
  }
  return { error: null, lab };
}

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
        const [submittedCount, activity] = await Promise.all([
          prisma.labWorkspace.count({ where: { labId: lab.id, isSubmitted: true } }),
          loadExamActivity(lab.id),
        ]);

        return {
          ...lab,
          status: getExamStatus(lab),
          appearedCount: activity.startedAttempts,
          submittedCount,
          pendingCount: Math.max(activity.startedAttempts - submittedCount, 0),
          violationCount: activity.violations,
          // Lets the lecturer's UI open the correct dialog — permanent delete, or archive —
          // without first attempting a delete. The server re-derives this on every DELETE
          // regardless, so a stale or forged value here changes nothing.
          activity,
          canDelete: !hasStudentActivity(activity),
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

    const { error, lab: existing } = await assertLabAccess(id, session!);
    if (error) return error;

    // THE GUARD. Every relation on Lab cascades, so this delete would take the workspaces,
    // submissions, awarded marks, integrity log, question sets and answer-sheet format with
    // it. Re-derived here on every request from the database, never from anything the
    // client sent, so calling this endpoint directly cannot get past it.
    const activity = await loadExamActivity(id);
    if (hasStudentActivity(activity)) {
      return NextResponse.json(
        {
          error: deletionRefusalMessage(activity),
          code: 'EXAM_HAS_STUDENT_ACTIVITY',
          canArchive: true,
          alreadyArchived: existing!.archivedAt !== null,
          // Counts only. Enough for the lecturer to understand the cost; nothing that
          // identifies a student.
          activity,
          archivePreserves: ARCHIVE_PRESERVES,
          archiveEffects: ARCHIVE_EFFECTS,
        },
        { status: 409 }
      );
    }

    // No student has touched it, so nothing of theirs is lost. Record the deletion before
    // performing it: ExamAdminAction.labId is SetNull, so the row survives the exam and the
    // title snapshot keeps it meaningful.
    await prisma.examAdminAction.create({
      data: {
        labId: id,
        labTitle: existing!.title,
        actorId: session!.userId,
        action: EXAM_ADMIN_ACTIONS.DELETE,
        details: `Permanently deleted "${existing!.title}" — no student attempts, submissions, files or integrity events existed`,
      },
    });

    await prisma.lab.delete({ where: { id } });

    return NextResponse.json({ message: 'Exam deleted successfully' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}

// PATCH — archive or restore an examination.
//
// Archiving is the answer to "this exam must go away but its student work must not". It
// writes one timestamp and touches nothing else, which is exactly why the preservation
// claims in ARCHIVE_PRESERVES are safe to make. getExamStatus then reports ARCHIVED, and
// because both the workspace route and the execution engine already refuse anything that
// is not RUNNING, every attempt entry point closes without a new check in either of them.
export async function PATCH(req: Request) {
  const { errorResponse, session } = requireAuth(req, ['LECTURER', 'ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const { id, archived } = await req.json();

    if (!id) {
      return NextResponse.json({ error: 'Exam ID is required' }, { status: 400 });
    }
    if (typeof archived !== 'boolean') {
      return NextResponse.json({ error: 'archived must be true or false' }, { status: 400 });
    }

    const { error, lab: existing } = await assertLabAccess(id, session!);
    if (error) return error;

    const alreadyInState = archived === (existing!.archivedAt !== null);
    if (alreadyInState) {
      // Idempotent: the exam is already where the caller wants it. Report success without
      // writing a second audit row for an action that changed nothing.
      return NextResponse.json({
        message: archived ? 'Exam is already archived' : 'Exam is already active',
        lab: { id: existing!.id, archivedAt: existing!.archivedAt, status: getExamStatus(existing!) },
      });
    }

    const activity = await loadExamActivity(id);

    const updated = await prisma.lab.update({
      where: { id },
      data: { archivedAt: archived ? new Date() : null },
    });

    await prisma.examAdminAction.create({
      data: {
        labId: id,
        labTitle: existing!.title,
        actorId: session!.userId,
        action: archived ? EXAM_ADMIN_ACTIONS.ARCHIVE : EXAM_ADMIN_ACTIONS.UNARCHIVE,
        details: archived
          ? `Archived "${existing!.title}" — preserved ${describeActivity(activity)}`
          : `Restored "${existing!.title}" to active examinations`,
      },
    });

    return NextResponse.json({
      message: archived ? 'Exam archived' : 'Exam restored',
      lab: { id: updated.id, archivedAt: updated.archivedAt, status: getExamStatus(updated) },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
