import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  const { errorResponse } = requireAuth(req, ['ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const totalLecturers = await prisma.user.count({ where: { role: 'LECTURER' } });
    const totalStudents = await prisma.user.count({ where: { role: 'STUDENT' } });
    const totalLabs = await prisma.lab.count();
    const totalSubmissions = await prisma.submission.count();

    const approvedSubmissions = await prisma.submission.count({ where: { status: 'APPROVED' } });
    const pendingSubmissions = await prisma.submission.count({ where: { status: 'PENDING' } });
    const rejectedSubmissions = await prisma.submission.count({ where: { status: 'REJECTED' } });
    const correctionSubmissions = await prisma.submission.count({ where: { status: 'NEEDS_CORRECTION' } });

    // Lecturer-wise breakdown
    const lecturers = await prisma.user.findMany({
      where: { role: 'LECTURER' },
      select: { id: true, name: true, email: true },
    });

    const lecturerBreakdown = await Promise.all(
      lecturers.map(async (lec) => {
        const labCount = await prisma.lab.count({ where: { lecturerId: lec.id } });
        const submissions = await prisma.submission.count({
          where: { lab: { lecturerId: lec.id } },
        });
        const evaluated = await prisma.submission.count({
          where: {
            lab: { lecturerId: lec.id },
            status: { not: 'PENDING' },
          },
        });

        return {
          id: lec.id,
          name: lec.name,
          email: lec.email,
          labCount,
          submissions,
          evaluated,
        };
      })
    );

    return NextResponse.json({
      stats: {
        totalLecturers,
        totalStudents,
        totalLabs,
        totalSubmissions,
        approvedSubmissions,
        pendingSubmissions,
        rejectedSubmissions,
        correctionSubmissions,
      },
      lecturerBreakdown,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
