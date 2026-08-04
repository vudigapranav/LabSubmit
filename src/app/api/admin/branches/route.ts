import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

async function validateBranchRange(year: number, rollStart: string | null, rollEnd: string | null, excludeBranchId?: string) {
  if (!rollStart || !rollEnd) return null;

  const trimmedStart = rollStart.trim();
  const trimmedEnd = rollEnd.trim();

  let newStart: bigint, newEnd: bigint;
  try {
    newStart = BigInt(trimmedStart);
    newEnd = BigInt(trimmedEnd);
  } catch (e) {
    return 'Roll Number Start and Roll Number End must be numeric (e.g. 160125733001).';
  }

  if (newStart > newEnd) {
    return 'Roll Number Start must be less than or equal to Roll Number End.';
  }

  const existingBranches = await prisma.branch.findMany({
    where: {
      year,
      isActive: true,
      ...(excludeBranchId ? { id: { not: excludeBranchId } } : {}),
    },
  });

  for (const b of existingBranches) {
    if (b.rollStart && b.rollEnd) {
      try {
        const exStart = BigInt(b.rollStart);
        const exEnd = BigInt(b.rollEnd);

        if (newStart <= exEnd && newEnd >= exStart) {
          return `Roll number range (${trimmedStart}–${trimmedEnd}) overlaps with existing branch ${b.name} (${b.rollStart}–${b.rollEnd}) for Year ${year}.`;
        }
      } catch (e) {
        // ignore invalid legacy entries
      }
    }
  }

  return null;
}

export async function GET(req: Request) {
  const { errorResponse } = requireAuth(req, ['ADMIN', 'LECTURER']);
  if (errorResponse) return errorResponse;

  try {
    const { searchParams } = new URL(req.url);
    const yearStr = searchParams.get('year');

    const whereClause: any = {};
    if (yearStr) {
      whereClause.year = parseInt(yearStr);
    }

    const branches = await prisma.branch.findMany({
      where: whereClause,
      include: {
        _count: { select: { students: true, subjects: true, labs: true } },
      },
      orderBy: [{ year: 'asc' }, { name: 'asc' }],
    });

    return NextResponse.json({ branches });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { errorResponse } = requireAuth(req, ['ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const { name, year, rollStart, rollEnd, isActive = true } = body;

    if (!name || !year) {
      return NextResponse.json({ error: 'Branch name and academic year are required' }, { status: 400 });
    }

    const rangeError = await validateBranchRange(parseInt(year), rollStart, rollEnd);
    if (rangeError) {
      return NextResponse.json({ error: rangeError }, { status: 400 });
    }

    const branch = await prisma.branch.create({
      data: {
        name: name.trim(),
        year: parseInt(year),
        rollStart: rollStart ? rollStart.trim() : null,
        rollEnd: rollEnd ? rollEnd.trim() : null,
        isActive: Boolean(isActive),
      },
    });

    return NextResponse.json({ message: 'Branch created successfully', branch });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const { errorResponse } = requireAuth(req, ['ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const { id, name, year, rollStart, rollEnd, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: 'Branch ID is required' }, { status: 400 });
    }

    const existingBranch = await prisma.branch.findUnique({ where: { id } });
    if (!existingBranch) {
      return NextResponse.json({ error: 'Branch not found' }, { status: 404 });
    }

    const targetYear = year !== undefined ? parseInt(year) : existingBranch.year;
    const targetStart = rollStart !== undefined ? (rollStart ? rollStart.trim() : null) : existingBranch.rollStart;
    const targetEnd = rollEnd !== undefined ? (rollEnd ? rollEnd.trim() : null) : existingBranch.rollEnd;

    const rangeError = await validateBranchRange(targetYear, targetStart, targetEnd, id);
    if (rangeError) {
      return NextResponse.json({ error: rangeError }, { status: 400 });
    }

    const branch = await prisma.branch.update({
      where: { id },
      data: {
        ...(name && { name: name.trim() }),
        ...(year && { year: parseInt(year) }),
        rollStart: rollStart !== undefined ? (rollStart ? rollStart.trim() : null) : undefined,
        rollEnd: rollEnd !== undefined ? (rollEnd ? rollEnd.trim() : null) : undefined,
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      },
    });

    return NextResponse.json({ message: 'Branch updated successfully', branch });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const { errorResponse } = requireAuth(req, ['ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Branch ID is required' }, { status: 400 });
    }

    await prisma.branch.delete({ where: { id } });

    return NextResponse.json({ message: 'Branch deleted successfully' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
