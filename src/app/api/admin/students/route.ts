import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  const { errorResponse } = requireAuth(req, ['ADMIN']);
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
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const { errorResponse } = requireAuth(req, ['ADMIN']);
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

    return NextResponse.json({ message: 'Student updated successfully', user: updatedUser });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const { errorResponse } = requireAuth(req, ['ADMIN']);
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

    await prisma.user.delete({
      where: { id: userId },
    });

    return NextResponse.json({ message: 'Student deleted successfully' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
