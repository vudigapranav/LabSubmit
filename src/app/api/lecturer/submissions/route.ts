import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  const { errorResponse, session } = requireAuth(req, ['LECTURER', 'ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const { searchParams } = new URL(req.url);
    const year = searchParams.get('year');
    const branchId = searchParams.get('branchId');
    const labId = searchParams.get('labId');
    const status = searchParams.get('status');

    const whereClause: any = {};

    if (session!.role === 'LECTURER') {
      whereClause.lab = { lecturerId: session!.userId };
    }

    if (labId) {
      whereClause.labId = labId;
    }

    if (status) {
      whereClause.status = status;
    }

    if (year || branchId) {
      whereClause.lab = {
        ...whereClause.lab,
        ...(year ? { year: parseInt(year) } : {}),
        ...(branchId ? { branchId } : {}),
      };
    }

    const submissions = await prisma.submission.findMany({
      where: whereClause,
      include: {
        lab: {
          include: {
            branch: true,
            subject: true,
            answerSheetSections: { orderBy: { order: 'asc' } },
          },
        },
        student: {
          include: {
            studentProfile: {
              include: { branch: true },
            },
          },
        },
        workspace: {
          include: {
            files: true,
            answerSheetResponses: true,
            questionSet: { include: { questions: { orderBy: { order: 'asc' } } } },
          },
        },
      },
      orderBy: {
        student: {
          rollNumber: 'asc',
        },
      },
    });

    const violationCounts = await prisma.examViolation.groupBy({
      by: ['labId', 'studentId'],
      _count: { id: true },
    });
    const violationCountMap = new Map(
      violationCounts.map((v) => [`${v.labId}:${v.studentId}`, v._count.id])
    );

    const formattedSubmissions = submissions.map((sub) => ({
      id: sub.id,
      labId: sub.labId,
      studentId: sub.studentId,
      labTitle: sub.lab.title,
      year: sub.lab.year,
      branchName: sub.student.studentProfile?.branch?.name || sub.lab.branch?.name || 'N/A',
      subjectName: sub.lab.subject?.name || 'N/A',
      studentRollNumber: sub.student.rollNumber || sub.student.studentProfile?.rollNumber || 'N/A',
      studentName: sub.student.name,
      status: sub.status,
      marks: sub.marks,
      maxMarks: sub.maxMarks,
      remarks: sub.remarks,
      isPublished: sub.isPublished,
      submittedAt: sub.submittedAt,
      evaluatedAt: sub.evaluatedAt,
      autoSubmitted: sub.workspace.autoSubmitted,
      startedAt: sub.workspace.startedAt,
      startDeviceClass: sub.workspace.startDeviceClass,
      // Which set this student sat. Faculty-facing only — the student is never told.
      // Faculty-facing: which set this student sat, and the exact paper they were given.
      // This is the internal mapping the student is never shown.
      questionSetLabel: sub.workspace.questionSet?.label || null,
      questions: (sub.workspace.questionSet?.questions || []).map((q: any) => ({
        order: q.order,
        text: q.text,
        marks: q.marks,
      })),
      problemStatement: sub.workspace.questionSet
        ? sub.workspace.questionSet.questions.map((q: any) => `${q.order}. ${q.text}`).join('\n\n')
        : sub.lab.problemStatement,
      // The completed answer sheet: the exam's format, with this student's writing in it.
      answerSheet: sub.lab.answerSheetSections
        .filter((section: any) => section.enabled)
        .map((section: any) => ({
          id: section.id,
          key: section.key,
          label: section.label,
          order: section.order,
          required: section.required,
          maxMarks: section.maxMarks,
          contentSource: section.contentSource,
          content:
            sub.workspace.answerSheetResponses.find((r: any) => r.sectionId === section.id)?.content || '',
        })),
      fullscreenExitCount: sub.workspace.fullscreenExitCount,
      fullscreenExitThreshold: sub.lab.fullscreenExitThreshold,
      violationCount: violationCountMap.get(`${sub.labId}:${sub.studentId}`) || 0,
      files: sub.workspace.files.map((f: any) => ({
        id: f.id,
        filename: f.filename,
        content: f.content,
        language: f.language,
      })),
    }));

    return NextResponse.json({ submissions: formattedSubmissions });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
