import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  const { errorResponse, session } = requireAuth(req, ['STUDENT']);
  if (errorResponse) return errorResponse;

  try {
    const submissions = await prisma.submission.findMany({
      where: {
        studentId: session!.userId,
        // Both gates, deliberately. isPublished is the per-row flag the release action
        // sets; lab.resultsReleasedAt is the exam-level switch that set it. Requiring both
        // means a row that somehow carries a stale isPublished — a legacy record, a direct
        // database edit — still cannot surface until its exam has actually been released.
        isPublished: true,
        lab: { resultsReleasedAt: { not: null } },
      },
      include: {
        lab: {
          include: {
            lecturer: { select: { name: true, email: true } },
            branch: true,
            subject: true,
          },
        },
      },
      orderBy: { evaluatedAt: 'desc' },
    });

    const grades = submissions.map((sub) => ({
      id: sub.id,
      labTitle: sub.lab.title,
      year: sub.lab.year,
      branchName: sub.lab.branch?.name || 'N/A',
      subjectName: sub.lab.subject?.name || 'N/A',
      lecturerName: sub.lab.lecturer.name,
      status: sub.status,
      marks: sub.marks,
      maxMarks: sub.maxMarks,
      remarks: sub.remarks,
      submittedAt: sub.submittedAt,
      evaluatedAt: sub.evaluatedAt,
    }));

    return NextResponse.json({ grades });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
