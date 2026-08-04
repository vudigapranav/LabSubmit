import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  const { errorResponse, session } = requireAuth(req, ['LECTURER', 'ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const { searchParams } = new URL(req.url);
    const yearParam = searchParams.get('year');
    const branchIdParam = searchParams.get('branchId');

    const whereClause: any = {};
    if (session!.role === 'LECTURER') {
      whereClause.lecturerId = session!.userId;
    }
    if (yearParam) {
      whereClause.year = parseInt(yearParam);
    }
    if (branchIdParam) {
      whereClause.branchId = branchIdParam;
    }

    // Fetch assigned subjects
    const subjects = await prisma.subject.findMany({
      where: whereClause,
      include: {
        branch: true,
        _count: { select: { labs: true } },
      },
      orderBy: [{ year: 'asc' }, { name: 'asc' }],
    });

    // Extract assigned years & branches for dropdown filters
    const allAssignedSubjects = await prisma.subject.findMany({
      where: session!.role === 'LECTURER' ? { lecturerId: session!.userId } : {},
      include: { branch: true },
    });

    const assignedYears = Array.from(new Set(allAssignedSubjects.map((s) => s.year))).sort((a, b) => a - b);
    
    // Map branches
    const branchMap = new Map();
    allAssignedSubjects.forEach((s) => {
      if (s.branch && (!yearParam || s.year === parseInt(yearParam))) {
        branchMap.set(s.branch.id, s.branch);
      }
    });
    const assignedBranches = Array.from(branchMap.values()).sort((a: any, b: any) => a.name.localeCompare(b.name));

    return NextResponse.json({
      subjects,
      assignedYears,
      assignedBranches,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
