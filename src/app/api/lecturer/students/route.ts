import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  const { errorResponse } = requireAuth(req, ['LECTURER', 'ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const { searchParams } = new URL(req.url);
    const year = searchParams.get('year');
    const branchId = searchParams.get('branchId');

    const whereClause: any = {};

    if (year) {
      whereClause.year = parseInt(year);
    }

    if (branchId) {
      whereClause.branchId = branchId;
    }

    const students = await prisma.studentProfile.findMany({
      where: whereClause,
      include: {
        user: {
          select: { id: true, name: true, rollNumber: true, email: true, createdAt: true },
        },
        branch: true,
      },
      orderBy: {
        rollNumber: 'asc',
      },
    });

    const formatted = students.map((s) => ({
      id: s.id,
      userId: s.userId,
      rollNumber: s.rollNumber,
      name: s.user.name,
      email: s.user.email,
      year: s.year,
      branchName: s.branch?.name || 'Unassigned',
      createdAt: s.user.createdAt,
    }));

    return NextResponse.json({ students: formatted });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
