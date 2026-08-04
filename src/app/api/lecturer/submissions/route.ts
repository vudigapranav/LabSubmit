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
          include: { branch: true, subject: true },
        },
        student: {
          include: {
            studentProfile: {
              include: { branch: true },
            },
          },
        },
        workspace: {
          include: { files: true },
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
