import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';

export async function GET(req: Request) {
  const { errorResponse } = await requireAuth(req, ['ADMIN', 'LECTURER']);
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
    console.error('[/api/admin/subjects]', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { errorResponse } = await requireAuth(req, ['ADMIN']);
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
    console.error('[/api/admin/subjects]', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const { errorResponse } = await requireAuth(req, ['ADMIN']);
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
    console.error('[/api/admin/subjects]', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const { errorResponse, session } = await requireAuth(req, ['ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Subject ID is required' }, { status: 400 });
    }

    const subject = await prisma.subject.findUnique({ where: { id } });
    if (!subject) return NextResponse.json({ error: 'Subject not found' }, { status: 404 });

    // Students find their exams through their subjects, so deleting a subject (Lab.subjectId
    // is SetNull) makes every one of its exams invisible to students — including results they
    // were waiting for. A subject with exams is never deleted.
    const exams = await prisma.lab.count({ where: { subjectId: id } });
    if (exams > 0) {
      return NextResponse.json(
        {
          error: `${subject.name} has ${exams} examination(s). Deleting it would hide them from students. Delete or archive its examinations first, or edit the subject instead.`,
          code: 'SUBJECT_IN_USE',
          counts: { exams },
        },
        { status: 409 }
      );
    }

    await prisma.subject.delete({ where: { id } });
    await recordAudit({ action: 'ADMIN_SUBJECT_DELETED', category: 'ADMIN', actorId: session!.userId, actorRole: session!.role, targetType: 'Subject', targetId: id, metadata: { name: subject.name, code: subject.code } });

    return NextResponse.json({ message: 'Subject deleted successfully' });
  } catch (error: any) {
    console.error('[/api/admin/subjects]', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
