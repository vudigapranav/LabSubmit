import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { detectLanguage } from '@/lib/compiler';
import { assignableSets, chooseSetId } from '@/lib/questionSets';
import { initialFileForLab } from '@/lib/workspaceBootstrap';

// Faculty control over WHICH set each student sits.
//
// Assignment normally happens by itself: a student who starts an exam is given a set at
// random and keeps it. This route exists for the two things that cannot happen by
// themselves — generating assignments up front so a cohort is settled before the exam
// opens, and an authorised lecturer overriding one student's assignment after the fact.
//
// Both are deliberate administrative acts and both are audited. Neither ever re-draws a set
// a student already holds: reassignment happens only when a named lecturer asks for one
// named student, never as a side effect of anything.

/**
 * Students eligible for an exam: same year and branch the exam targets. Mirrors how
 * /api/student/labs decides which exams a student can see, so the two cannot disagree about
 * who is sitting the paper.
 */
async function eligibleStudentIds(lab: { year: number; branchId: string | null }): Promise<string[]> {
  const profiles = await prisma.studentProfile.findMany({
    where: { year: lab.year, ...(lab.branchId ? { branchId: lab.branchId } : {}) },
    select: { userId: true },
  });
  return profiles.map((p) => p.userId);
}

async function assertLabAccess(labId: string, session: { role: string; userId: string }) {
  const lab = await prisma.lab.findUnique({ where: { id: labId } });
  if (!lab) return { error: NextResponse.json({ error: 'Exam not found' }, { status: 404 }), lab: null };
  if (session.role === 'LECTURER' && lab.lecturerId !== session.userId) {
    return { error: NextResponse.json({ error: 'You do not have access to this exam.' }, { status: 403 }), lab: null };
  }
  return { error: null, lab };
}

// GET — the assignment picture for an exam: who is eligible, who holds a set, who does not.
export async function GET(req: Request) {
  const { errorResponse, session } = requireAuth(req, ['LECTURER', 'ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const { searchParams } = new URL(req.url);
    const labId = searchParams.get('labId');
    if (!labId) return NextResponse.json({ error: 'Exam ID is required' }, { status: 400 });

    const { error, lab } = await assertLabAccess(labId, session!);
    if (error) return error;

    const eligible = await eligibleStudentIds(lab!);
    const assigned = await prisma.labWorkspace.count({ where: { labId, questionSetId: { not: null } } });
    const sets = await prisma.questionSet.findMany({
      where: { labId },
      select: { id: true, label: true, isActive: true, questions: { select: { order: true, text: true, marks: true } } },
    });

    const recentActions = await prisma.examAdminAction.findMany({
      where: { labId },
      include: { actor: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });

    return NextResponse.json({
      eligibleCount: eligible.length,
      assignedCount: assigned,
      assignableSetCount: assignableSets(sets).length,
      adminActions: recentActions.map((a) => ({
        action: a.action,
        details: a.details,
        actorName: a.actor.name,
        createdAt: a.createdAt,
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}

// POST — action: 'generate' | 'reassign'
export async function POST(req: Request) {
  const { errorResponse, session } = requireAuth(req, ['LECTURER', 'ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const { labId, action, studentId, questionSetId } = await req.json();
    if (!labId || !action) {
      return NextResponse.json({ error: 'Exam ID and action are required' }, { status: 400 });
    }

    const { error, lab } = await assertLabAccess(labId, session!);
    if (error) return error;

    const sets = await prisma.questionSet.findMany({
      where: { labId, isActive: true },
      select: { id: true, label: true, isActive: true, questions: { select: { order: true, text: true, marks: true } } },
    });
    const eligible = assignableSets(sets);

    // ---------------------------------------------------------------- generate
    if (action === 'generate') {
      if (eligible.length === 0) {
        return NextResponse.json(
          { error: 'No assignable question set exists. A set must be active and contain at least one question.' },
          { status: 400 }
        );
      }

      const studentIds = await eligibleStudentIds(lab!);
      if (studentIds.length === 0) {
        return NextResponse.json({ error: 'No students are eligible for this exam.' }, { status: 400 });
      }

      const existing = await prisma.labWorkspace.findMany({
        where: { labId, studentId: { in: studentIds } },
        select: { id: true, studentId: true, questionSetId: true },
      });
      const byStudent = new Map(existing.map((w) => [w.studentId, w]));

      // Seed the running tally from assignments that already exist, so generating a second
      // time (after new students enrol) keeps the whole cohort balanced rather than
      // balancing only the newcomers among themselves.
      const usage = await prisma.labWorkspace.groupBy({
        by: ['questionSetId'],
        where: { labId, questionSetId: { not: null } },
        _count: { questionSetId: true },
      });
      const tally = new Map(usage.map((u) => [u.questionSetId as string, u._count.questionSetId]));

      const boilerplate = initialFileForLab(lab!.allowedLanguages);
      let created = 0;
      let assigned = 0;
      let skipped = 0;

      for (const studentId of studentIds) {
        const workspace = byStudent.get(studentId);

        // An existing assignment is NEVER re-drawn. Generation fills gaps; it does not
        // shuffle a cohort, because a student who already holds a set may already be
        // sitting it.
        if (workspace?.questionSetId) {
          skipped++;
          continue;
        }

        const chosen = chooseSetId(eligible, tally);
        if (!chosen) break;
        tally.set(chosen, (tally.get(chosen) || 0) + 1);

        if (workspace) {
          await prisma.labWorkspace.update({ where: { id: workspace.id }, data: { questionSetId: chosen } });
        } else {
          // Created with the same starter file a student would get by opening the exam
          // themselves, and deliberately WITHOUT startedAt — pre-assigning a set must never
          // start anyone's clock.
          await prisma.labWorkspace.create({
            data: {
              labId,
              studentId,
              questionSetId: chosen,
              files: {
                create: [
                  {
                    filename: boilerplate.filename,
                    language: detectLanguage(boilerplate.filename),
                    content: boilerplate.content,
                  },
                ],
              },
            },
          });
          created++;
        }
        assigned++;
      }

      await prisma.examAdminAction.create({
        data: {
          labId,
          actorId: session!.userId,
          action: 'GENERATE_ASSIGNMENTS',
          details: `Assigned ${assigned} student(s) across ${eligible.length} set(s); ${skipped} already had an assignment and were left untouched`,
        },
      });

      return NextResponse.json({
        message: `Assigned ${assigned} student${assigned === 1 ? '' : 's'}.${skipped > 0 ? ` ${skipped} already had a set and were left unchanged.` : ''}`,
        assigned,
        created,
        skipped,
        eligibleCount: studentIds.length,
      });
    }

    // ---------------------------------------------------------------- reassign
    if (action === 'reassign') {
      if (!studentId || !questionSetId) {
        return NextResponse.json({ error: 'Student and question set are required' }, { status: 400 });
      }

      const target = await prisma.questionSet.findFirst({ where: { id: questionSetId, labId } });
      if (!target) {
        return NextResponse.json({ error: 'That question set does not belong to this exam.' }, { status: 404 });
      }

      const workspace = await prisma.labWorkspace.findFirst({
        where: { labId, studentId },
        include: { questionSet: { select: { label: true } }, student: { select: { name: true, rollNumber: true } } },
      });
      if (!workspace) {
        return NextResponse.json({ error: 'This student has no workspace for this exam yet.' }, { status: 404 });
      }

      // A submitted attempt is a finished record. Its answers were written against the paper
      // the student actually sat, so swapping the paper afterwards would misrepresent what
      // they were asked — an evaluator would grade answers against the wrong questions.
      if (workspace.isSubmitted) {
        return NextResponse.json(
          { error: 'This student has already submitted. Their assigned set is part of the submitted record and cannot be changed.' },
          { status: 409 }
        );
      }

      await prisma.labWorkspace.update({ where: { id: workspace.id }, data: { questionSetId } });

      const wasLive = Boolean(workspace.startedAt);
      await prisma.examAdminAction.create({
        data: {
          labId,
          actorId: session!.userId,
          action: 'REASSIGN_SET',
          details: `${workspace.student.rollNumber || workspace.student.name}: ${workspace.questionSet?.label || 'unassigned'} → ${target.label}${wasLive ? ' (attempt was already in progress)' : ''}`,
        },
      });

      return NextResponse.json({
        message: `Reassigned to ${target.label}.${wasLive ? ' Their attempt was already in progress — their questions have changed.' : ''}`,
        wasLive,
      });
    }

    return NextResponse.json({ error: 'Invalid action specified' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
