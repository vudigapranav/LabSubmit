import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { gradableSections } from '@/lib/answerSheet';

export async function GET(req: Request) {
  const { errorResponse, session } = await requireAuth(req, ['STUDENT']);
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
            answerSheetSections: { orderBy: { order: 'asc' } },
          },
        },
        sectionEvaluations: true,
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
      // Per-section breakdown, only for sections the lecturer weighted. Reaches the student
      // only through this route, which already returns published results only.
      sections: gradableSections(sub.lab.answerSheetSections).map((section) => {
        const e = sub.sectionEvaluations.find((ev) => ev.sectionId === section.id);
        return { label: section.label, maxMarks: section.maxMarks, marks: e?.marks ?? null, remarks: e?.remarks ?? null };
      }),
    }));

    return NextResponse.json({ grades });
  } catch (error) {
    console.error('[grades] GET failed:', error);
    return NextResponse.json({ error: 'Could not load your results.' }, { status: 500 });
  }
}
