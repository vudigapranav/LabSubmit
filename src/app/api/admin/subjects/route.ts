import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  const { errorResponse } = requireAuth(req, ['ADMIN', 'LECTURER']);
  if (errorResponse) return errorResponse;

  try {
    const { searchParams } = new URL(req.url);
    const yearStr = searchParams.get('year');
    const branchId = searchParams.get('branchId');

    const whereClause: any = {};
    if (yearStr) whereClause.year = parseInt(yearStr);
    if (branchId) whereClause.branchId = branchId;

    const subjects = await prisma.subject.findMany({
      where: whereClause,
      include: {
        branch: true,
        lecturer: { select: { id: true, name: true, email: true } },
        _count: { select: { labs: true } },
      },
      orderBy: [{ year: 'asc' }, { name: 'asc' }],
    });

    return NextResponse.json({ subjects });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { errorResponse } = requireAuth(req, ['ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const { name, code, semester, year, branchId, lecturerId } = body;

    if (!name || !branchId || !year) {
      return NextResponse.json({ error: 'Subject name, branch, and academic year are required' }, { status: 400 });
    }

    const subject = await prisma.subject.create({
      data: {
        name: name.trim(),
        code: code ? code.trim() : `SUB${Math.floor(Math.random() * 1000)}`,
        semester: semester ? parseInt(semester) : null,
        year: parseInt(year),
        branchId,
        lecturerId: lecturerId || null,
      },
      include: {
        branch: true,
        lecturer: { select: { id: true, name: true, email: true } },
      },
    });

    return NextResponse.json({ message: 'Subject created successfully', subject });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const { errorResponse } = requireAuth(req, ['ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const { id, name, code, semester, year, branchId, lecturerId } = body;

    if (!id) {
      return NextResponse.json({ error: 'Subject ID is required' }, { status: 400 });
    }

    const subject = await prisma.subject.update({
      where: { id },
      data: {
        ...(name && { name: name.trim() }),
        ...(code && { code: code.trim() }),
        semester: semester !== undefined ? (semester ? parseInt(semester) : null) : undefined,
        ...(year && { year: parseInt(year) }),
        ...(branchId && { branchId }),
        lecturerId: lecturerId !== undefined ? (lecturerId || null) : undefined,
      },
      include: {
        branch: true,
        lecturer: { select: { id: true, name: true, email: true } },
      },
    });

    return NextResponse.json({ message: 'Subject updated successfully', subject });
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
      return NextResponse.json({ error: 'Subject ID is required' }, { status: 400 });
    }

    await prisma.subject.delete({ where: { id } });

    return NextResponse.json({ message: 'Subject deleted successfully' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
