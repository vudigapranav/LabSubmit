import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { normalizeQuestions, normalizeSetLabel } from '@/lib/questionSets';

// Faculty-only authoring of an exam's question sets. There is deliberately no student
// counterpart to this route: a student receives their questions through the workspace
// payload, already stripped of set identity, and has no endpoint that could enumerate sets.

async function assertLabAccess(labId: string, session: { role: string; userId: string }) {
  const lab = await prisma.lab.findUnique({ where: { id: labId } });
  if (!lab) return { error: NextResponse.json({ error: 'Exam not found' }, { status: 404 }), lab: null };
  if (session.role === 'LECTURER' && lab.lecturerId !== session.userId) {
    return { error: NextResponse.json({ error: 'You do not have access to this exam.' }, { status: 403 }), lab: null };
  }
  return { error: null, lab };
}

// GET /api/lecturer/question-sets?labId=...
// Returns every set with its questions, plus how many students each has been assigned —
// the student-to-set mapping faculty need for evaluation and for investigating
// irregularities.
export async function GET(req: Request) {
  const { errorResponse, session } = requireAuth(req, ['LECTURER', 'ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const { searchParams } = new URL(req.url);
    const labId = searchParams.get('labId');
    if (!labId) return NextResponse.json({ error: 'Exam ID is required' }, { status: 400 });

    const { error } = await assertLabAccess(labId, session!);
    if (error) return error;

    const sets = await prisma.questionSet.findMany({
      where: { labId },
      include: { questions: { orderBy: { order: 'asc' } } },
      orderBy: { order: 'asc' },
    });

    const usage = await prisma.labWorkspace.groupBy({
      by: ['questionSetId'],
      where: { labId, questionSetId: { not: null } },
      _count: { questionSetId: true },
    });
    const usageById = new Map(usage.map((u) => [u.questionSetId as string, u._count.questionSetId]));

    // The mapping itself, for faculty eyes only.
    const assignments = await prisma.labWorkspace.findMany({
      where: { labId, questionSetId: { not: null } },
      select: {
        startedAt: true,
        isSubmitted: true,
        studentId: true,
        questionSetId: true,
        questionSet: { select: { label: true } },
        student: { select: { name: true, rollNumber: true } },
      },
      orderBy: { student: { rollNumber: 'asc' } },
    });

    return NextResponse.json({
      sets: sets.map((s) => ({ ...s, assignedCount: usageById.get(s.id) || 0 })),
      // studentId and questionSetId are included so faculty can act on a row (reassign).
      // This is a lecturer-only route; the student payload is built elsewhere and never
      // carries either field.
      assignments: assignments.map((a) => ({
        studentId: a.studentId,
        studentName: a.student.name,
        rollNumber: a.student.rollNumber,
        questionSetId: a.questionSetId,
        setLabel: a.questionSet?.label || null,
        startedAt: a.startedAt,
        isSubmitted: a.isSubmitted,
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}

// POST — create a set for an exam.
export async function POST(req: Request) {
  const { errorResponse, session } = requireAuth(req, ['LECTURER', 'ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const { labId, label, questions } = await req.json();
    if (!labId) return NextResponse.json({ error: 'Exam ID is required' }, { status: 400 });

    const { error } = await assertLabAccess(labId, session!);
    if (error) return error;

    const existingCount = await prisma.questionSet.count({ where: { labId } });
    const normalized = normalizeQuestions(questions);

    const set = await prisma.questionSet.create({
      data: {
        labId,
        // "Set A", "Set B", … by default; the lecturer can rename it. Students never see it.
        label: normalizeSetLabel(label, `Set ${String.fromCharCode(65 + (existingCount % 26))}`),
        order: existingCount + 1,
        questions: { create: normalized.map((q) => ({ order: q.order, text: q.text, marks: q.marks })) },
      },
      include: { questions: { orderBy: { order: 'asc' } } },
    });

    return NextResponse.json({ message: 'Question set created', set });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}

// PUT — update a set's label, active flag and full question list.
export async function PUT(req: Request) {
  const { errorResponse, session } = requireAuth(req, ['LECTURER', 'ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const { id, label, isActive, questions, acknowledgeLiveEdit } = await req.json();
    if (!id) return NextResponse.json({ error: 'Question set ID is required' }, { status: 400 });

    const existing = await prisma.questionSet.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: 'Question set not found' }, { status: 404 });

    const { error } = await assertLabAccess(existing.labId, session!);
    if (error) return error;

    // Once students are sitting a set, its questions are effectively frozen: replacing them
    // rewrites the paper of an attempt already under way, which is the single most damaging
    // thing this endpoint can do. It is refused by default and permitted only when the
    // lecturer explicitly acknowledges the consequence — and that override is audited.
    //
    // Renaming the set or deactivating it stays freely allowed: neither changes any
    // student's questions, and deactivating is the safe way to retire a bad set.
    if (questions !== undefined) {
      const liveAttempts = await prisma.labWorkspace.count({
        where: { questionSetId: id, startedAt: { not: null }, isSubmitted: false },
      });

      if (liveAttempts > 0 && !acknowledgeLiveEdit) {
        return NextResponse.json(
          {
            error: `${liveAttempts} student${liveAttempts === 1 ? ' is' : 's are'} sitting this set right now. Changing its questions would rewrite the paper in front of them mid-examination. Deactivate the set instead to keep it out of future assignments, or confirm explicitly if you intend to change a live paper.`,
            requiresAcknowledgement: true,
            liveAttempts,
          },
          { status: 409 }
        );
      }

      if (liveAttempts > 0) {
        await prisma.examAdminAction.create({
          data: {
            labId: existing.labId,
            actorId: session!.userId,
            action: 'EDIT_LIVE_QUESTION_SET',
            details: `Replaced the questions of "${existing.label}" while ${liveAttempts} attempt(s) were in progress`,
          },
        });
      }
    }

    // Questions are replaced wholesale rather than diffed. They carry no student-authored
    // content — answers live on the workspace, never here — so nothing is lost, and a
    // wholesale replace keeps ordering trivially correct after a reorder or deletion.
    const ops: any[] = [
      prisma.questionSet.update({
        where: { id },
        data: {
          ...(label !== undefined && { label: normalizeSetLabel(label, existing.label) }),
          ...(isActive !== undefined && { isActive: Boolean(isActive) }),
        },
      }),
    ];

    if (questions !== undefined) {
      const normalized = normalizeQuestions(questions);
      ops.push(prisma.question.deleteMany({ where: { questionSetId: id } }));
      ops.push(
        prisma.question.createMany({
          data: normalized.map((q) => ({ questionSetId: id, order: q.order, text: q.text, marks: q.marks })),
        })
      );
    }

    await prisma.$transaction(ops);

    const set = await prisma.questionSet.findUnique({
      where: { id },
      include: { questions: { orderBy: { order: 'asc' } } },
    });

    return NextResponse.json({ message: 'Question set updated', set });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}

// DELETE — remove a set entirely.
export async function DELETE(req: Request) {
  const { errorResponse, session } = requireAuth(req, ['LECTURER', 'ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Question set ID is required' }, { status: 400 });

    const existing = await prisma.questionSet.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: 'Question set not found' }, { status: 404 });

    const { error } = await assertLabAccess(existing.labId, session!);
    if (error) return error;

    // Deleting a set students are already sitting would blank their paper mid-exam
    // (LabWorkspace.questionSetId is SetNull), so it is refused. Deactivating it instead
    // keeps existing attempts intact while removing it from future assignment.
    const assigned = await prisma.labWorkspace.count({ where: { questionSetId: id } });
    if (assigned > 0) {
      return NextResponse.json(
        {
          error: `This set is already assigned to ${assigned} student${assigned === 1 ? '' : 's'} and cannot be deleted. Deactivate it instead — it will stop being given to new students while their papers stay intact.`,
          assignedCount: assigned,
        },
        { status: 409 }
      );
    }

    await prisma.questionSet.delete({ where: { id } });
    return NextResponse.json({ message: 'Question set deleted' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
