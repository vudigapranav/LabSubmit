import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  const { errorResponse, session } = requireAuth(req, ['LECTURER', 'ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const { searchParams } = new URL(req.url);
    const labId = searchParams.get('labId');
    const year = searchParams.get('year');
    const branchId = searchParams.get('branchId');

    const labWhere: any = {};
    if (session!.role === 'LECTURER') {
      labWhere.lecturerId = session!.userId;
    }
    if (year) labWhere.year = parseInt(year);
    if (branchId) labWhere.branchId = branchId;

    const whereClause: any = { lab: labWhere };
    if (labId) whereClause.labId = labId;

    const violations = await prisma.examViolation.findMany({
      where: whereClause,
      include: {
        lab: { select: { title: true } },
        student: {
          select: { name: true, rollNumber: true, studentProfile: { select: { rollNumber: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    // Total violation count per student, scoped per exam (query results are newest-first).
    const totalCounts = new Map<string, number>();
    for (const v of violations) {
      const key = `${v.labId}:${v.studentId}`;
      totalCounts.set(key, (totalCounts.get(key) || 0) + 1);
    }

    const formatted = violations.map((v) => ({
      id: v.id,
      labId: v.labId,
      examTitle: v.lab.title,
      studentId: v.studentId,
      studentName: v.student.name,
      rollNumber: v.student.rollNumber || v.student.studentProfile?.rollNumber || 'N/A',
      type: v.type,
      details: v.details,
      createdAt: v.createdAt,
      violationCount: totalCounts.get(`${v.labId}:${v.studentId}`) || 1,
    }));

    return NextResponse.json({ violations: formatted });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
