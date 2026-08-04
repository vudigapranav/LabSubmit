import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getExamStatus, getEffectiveDeadline, parseAllowedLanguages } from '@/lib/examTiming';

export async function GET(req: Request) {
  const { errorResponse, session } = requireAuth(req, ['STUDENT']);
  if (errorResponse) return errorResponse;

  try {
    const studentUser = await prisma.user.findUnique({
      where: { id: session!.userId },
      include: {
        studentProfile: {
          include: { branch: true },
        },
      },
    });

    if (!studentUser || !studentUser.studentProfile) {
      return NextResponse.json({ error: 'Student profile not found' }, { status: 404 });
    }

    const { year, branchId, branch } = studentUser.studentProfile;

    // Fetch subjects for student's year and branch
    const subjects = await prisma.subject.findMany({
      where: {
        year: year,
        ...(branchId ? { branchId: branchId } : {}),
      },
      include: {
        lecturer: { select: { name: true, email: true } },
        branch: true,
        labs: {
          where: { isPublished: true }, // drafts stay hidden from students
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Decorate labs with submission status + computed exam status for this student
    const subjectsWithLabs = await Promise.all(
      subjects.map(async (sub) => {
        const labsWithStatus = await Promise.all(
          sub.labs.map(async (lab) => {
            const workspace = await prisma.labWorkspace.findFirst({
              where: { labId: lab.id, studentId: studentUser.id },
            });

            const submission = await prisma.submission.findFirst({
              where: { labId: lab.id, studentId: studentUser.id },
              orderBy: { submittedAt: 'desc' },
            });

            const status = getExamStatus(lab);
            const effectiveDeadline = workspace ? getEffectiveDeadline(lab, workspace) : lab.endTime;

            return {
              id: lab.id,
              title: lab.title,
              description: lab.description,
              problemStatement: lab.problemStatement,
              year: lab.year,
              lecturerName: sub.lecturer?.name || 'Unassigned',
              dueDate: lab.dueDate,
              allowCopy: lab.allowCopy,
              allowPaste: lab.allowPaste,
              allowCut: lab.allowCut,
              allowRightClick: lab.allowRightClick,
              allowDragDrop: lab.allowDragDrop,
              examDate: lab.examDate,
              startTime: lab.startTime,
              endTime: lab.endTime,
              durationMinutes: lab.durationMinutes,
              allowedLanguages: parseAllowedLanguages(lab.allowedLanguages),
              examModeEnabled: lab.examModeEnabled,
              status,
              effectiveDeadline,
              hasStarted: Boolean(workspace?.startedAt),
              isSubmitted: workspace ? workspace.isSubmitted : false,
              submissionStatus: submission ? submission.status : 'NOT_STARTED',
              marks: submission && submission.isPublished ? submission.marks : null,
              maxMarks: submission ? submission.maxMarks : 100,
              remarks: submission && submission.isPublished ? submission.remarks : null,
              isPublished: submission ? submission.isPublished : false,
            };
          })
        );

        return {
          id: sub.id,
          name: sub.name,
          code: sub.code,
          semester: sub.semester,
          year: sub.year,
          lecturer: sub.lecturer,
          branch: sub.branch,
          labs: labsWithStatus,
        };
      })
    );

    return NextResponse.json({
      studentInfo: {
        year,
        branchName: branch?.name || 'Unassigned',
        branchId,
      },
      subjects: subjectsWithLabs,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
