import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { recordAudit, requestIp } from '@/lib/audit';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  const { errorResponse, session } = await requireAuth(req, ['ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const { searchParams } = new URL(req.url);
    const yearStr = searchParams.get('year');
    const branchId = searchParams.get('branchId');

    const whereClause: any = {};
    if (yearStr) {
      whereClause.year = parseInt(yearStr);
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
      orderBy: { rollNumber: 'asc' },
    });

    const formattedStudents = await Promise.all(
      students.map(async (s) => {
        const submissionCount = await prisma.submission.count({
          where: { studentId: s.userId },
        });
        return {
          id: s.id,
          userId: s.userId,
          rollNumber: s.rollNumber,
          name: s.user?.name || 'Student',
          email: s.user?.email || '',
          year: s.year,
          branchId: s.branchId,
          branchName: s.branch?.name || 'Unassigned',
          submissionCount,
          createdAt: s.user?.createdAt,
        };
      })
    );

    return NextResponse.json({ students: formattedStudents });
  } catch (error: any) {
    console.error('[/api/admin/students]', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const { errorResponse, session } = await requireAuth(req, ['ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const { userId, name, email, rollNumber, year, branchId } = body;

    if (!userId) {
      return NextResponse.json({ error: 'Student User ID is required' }, { status: 400 });
    }

    const studentUser = await prisma.user.findUnique({
      where: { id: userId },
      include: { studentProfile: true },
    });

    if (!studentUser || studentUser.role !== 'STUDENT') {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    }

    const cleanRoll = rollNumber ? rollNumber.trim() : studentUser.rollNumber;
    const cleanName = name ? name.trim() : studentUser.name;
    const cleanEmail = email ? email.trim().toLowerCase() : studentUser.email;

    // Update User details
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        name: cleanName,
        email: cleanEmail,
        rollNumber: cleanRoll,
      },
    });

    // Update StudentProfile details
    if (studentUser.studentProfile) {
      await prisma.studentProfile.update({
        where: { id: studentUser.studentProfile.id },
        data: {
          rollNumber: cleanRoll,
          ...(year && { year: parseInt(year) }),
          ...(branchId && { branchId }),
        },
      });
    }

    await recordAudit({ action: 'ADMIN_STUDENT_UPDATED', category: 'ADMIN', actorId: session!.userId, actorRole: session!.role, targetType: 'User', targetId: userId, metadata: { fields: Object.keys(body).filter((k) => k !== 'userId') } });
    return NextResponse.json({ message: 'Student updated successfully', user: updatedUser });
  } catch (error: any) {
    console.error('[/api/admin/students]', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const { errorResponse, session } = await requireAuth(req, ['ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('id');

    if (!userId) {
      return NextResponse.json({ error: 'Student User ID is required' }, { status: 400 });
    }

    const studentUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!studentUser || studentUser.role !== 'STUDENT') {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    }

    // Workspaces, submissions and integrity events all cascade from the student. Once the
    // student has sat any exam, their account is a record of that work and is not deleted.
    const [attempts, submissions, violations] = await Promise.all([
      prisma.labWorkspace.count({ where: { studentId: userId, startedAt: { not: null } } }),
      prisma.submission.count({ where: { studentId: userId } }),
      prisma.examViolation.count({ where: { studentId: userId } }),
    ]);
    if (attempts + submissions + violations > 0) {
      return NextResponse.json(
        {
          error: `${studentUser.name} has ${attempts} exam attempt(s), ${submissions} submission(s) and ${violations} integrity event(s). Deleting the account would permanently delete that work and its marks. Reset the password instead if access is the problem.`,
          code: 'STUDENT_HAS_WORK',
          counts: { attempts, submissions, violations },
        },
        { status: 409 }
      );
    }

    await prisma.user.delete({
      where: { id: userId },
    });

    await recordAudit({ action: 'ADMIN_STUDENT_DELETED', category: 'ADMIN', actorId: session!.userId, actorRole: session!.role, targetType: 'User', targetId: userId });
    return NextResponse.json({ message: 'Student deleted successfully' });
  } catch (error: any) {
    console.error('[/api/admin/students]', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
