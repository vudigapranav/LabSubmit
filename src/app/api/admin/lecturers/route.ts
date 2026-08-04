import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';

// GET all lecturers
export async function GET(req: Request) {
  const { errorResponse } = requireAuth(req, ['ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const lecturers = await prisma.user.findMany({
      where: { role: 'LECTURER' },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        lecturerProfile: true,
        assignedSubjects: { select: { id: true, name: true, code: true, branch: true } },
      },
      orderBy: { name: 'asc' },
    });

    const lecturersWithStats = await Promise.all(
      lecturers.map(async (lec) => {
        const submissionCount = await prisma.submission.count({
          where: { lab: { lecturerId: lec.id } },
        });
        return {
          ...lec,
          submissionCount,
        };
      })
    );

    return NextResponse.json({ lecturers: lecturersWithStats });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}

// POST create lecturer
export async function POST(req: Request) {
  const { errorResponse } = requireAuth(req, ['ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const { name, email, password, department, maxStudents, phone } = body;

    if (!name || !email || !password) {
      return NextResponse.json({ error: 'Name, Email, and Password are required' }, { status: 400 });
    }

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail.endsWith('@cbit.in')) {
      return NextResponse.json({ error: 'Lecturer email must be a valid @cbit.in address (e.g. ramesh@cbit.in)' }, { status: 400 });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: trimmedEmail },
    });

    if (existingUser) {
      return NextResponse.json({ error: 'User with this email already exists' }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const lecturer = await prisma.user.create({
      data: {
        name,
        email: trimmedEmail,
        password: hashedPassword,
        role: 'LECTURER',
        lecturerProfile: {
          create: {
            department: department || 'Computer Science & Engineering',
            maxStudents: maxStudents ? parseInt(maxStudents) : 60,
            phone: phone || '',
          },
        },
      },
      include: { lecturerProfile: true },
    });

    return NextResponse.json({ message: 'Lecturer created successfully', lecturer });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}

// PUT edit lecturer
export async function PUT(req: Request) {
  const { errorResponse } = requireAuth(req, ['ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const { id, name, email, department, maxStudents, phone } = body;

    if (!id) {
      return NextResponse.json({ error: 'Lecturer ID is required' }, { status: 400 });
    }

    const lecturer = await prisma.user.findUnique({
      where: { id },
      include: { lecturerProfile: true },
    });

    if (!lecturer || lecturer.role !== 'LECTURER') {
      return NextResponse.json({ error: 'Lecturer not found' }, { status: 404 });
    }

    const updateData: any = {};
    if (name) updateData.name = name;
    if (email) {
      const trimmedEmail = email.trim().toLowerCase();
      if (!trimmedEmail.endsWith('@cbit.in')) {
        return NextResponse.json({ error: 'Lecturer email must end with @cbit.in' }, { status: 400 });
      }
      updateData.email = trimmedEmail;
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: updateData,
    });

    await prisma.lecturerProfile.upsert({
      where: { userId: id },
      update: {
        department: department !== undefined ? department : lecturer.lecturerProfile?.department,
        maxStudents: maxStudents !== undefined ? parseInt(maxStudents) : lecturer.lecturerProfile?.maxStudents,
        phone: phone !== undefined ? phone : lecturer.lecturerProfile?.phone,
      },
      create: {
        userId: id,
        department: department || 'CSE',
        maxStudents: maxStudents ? parseInt(maxStudents) : 60,
        phone: phone || '',
      },
    });

    return NextResponse.json({ message: 'Lecturer updated successfully', user: updatedUser });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}

// DELETE lecturer
export async function DELETE(req: Request) {
  const { errorResponse } = requireAuth(req, ['ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Lecturer ID is required' }, { status: 400 });
    }

    await prisma.user.delete({
      where: { id },
    });

    return NextResponse.json({ message: 'Lecturer deleted successfully' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
