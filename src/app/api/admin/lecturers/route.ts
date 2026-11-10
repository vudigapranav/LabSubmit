import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { checkPasswordPolicy } from '@/lib/passwordPolicy';
import { recordAudit, requestIp } from '@/lib/audit';
import bcrypt from 'bcryptjs';

// GET all lecturers
export async function GET(req: Request) {
  const { errorResponse, session } = await requireAuth(req, ['ADMIN']);
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
    console.error('[/api/admin/lecturers]', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// POST create lecturer
export async function POST(req: Request) {
  const { errorResponse, session } = await requireAuth(req, ['ADMIN']);
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

    const passwordProblem = checkPasswordPolicy(password);
    if (passwordProblem) {
      return NextResponse.json({ error: passwordProblem }, { status: 400 });
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

    await recordAudit({ action: 'ADMIN_LECTURER_CREATED', category: 'ADMIN', actorId: session!.userId, actorRole: session!.role, targetType: 'User', targetId: lecturer.id, metadata: { email: lecturer.email, name: lecturer.name } });
    return NextResponse.json({ message: 'Lecturer created successfully', lecturer });
  } catch (error: any) {
    console.error('[/api/admin/lecturers]', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// PUT edit lecturer
export async function PUT(req: Request) {
  const { errorResponse, session } = await requireAuth(req, ['ADMIN']);
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

    await recordAudit({ action: 'ADMIN_LECTURER_UPDATED', category: 'ADMIN', actorId: session!.userId, actorRole: session!.role, targetType: 'User', targetId: id, metadata: { fields: Object.keys(body).filter((k) => k !== 'id') } });
    return NextResponse.json({ message: 'Lecturer updated successfully', user: updatedUser });
  } catch (error: any) {
    console.error('[/api/admin/lecturers]', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// DELETE lecturer
export async function DELETE(req: Request) {
  const { errorResponse, session } = await requireAuth(req, ['ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Lecturer ID is required' }, { status: 400 });
    }

    // This endpoint deletes LECTURERS. Without the role check it deleted any account by id —
    // an administrator, a student, or the caller's own account.
    const lecturer = await prisma.user.findUnique({ where: { id } });
    if (!lecturer || lecturer.role !== 'LECTURER') {
      return NextResponse.json({ error: 'Lecturer not found' }, { status: 404 });
    }

    // Lab.lecturer is onDelete: Cascade, so deleting a lecturer deleted every exam they wrote
    // and with it every student's submission, marks and integrity log; ExamAdminAction.actor
    // cascades too, erasing the record of what they did. Refuse while either exists.
    const [exams, adminActions] = await Promise.all([
      prisma.lab.count({ where: { lecturerId: id } }),
      prisma.examAdminAction.count({ where: { actorId: id } }),
    ]);
    if (exams + adminActions > 0) {
      return NextResponse.json(
        {
          error: `${lecturer.name} authored ${exams} examination(s)${adminActions ? ` and has ${adminActions} recorded exam action(s)` : ''}. Deleting the account would permanently delete those examinations and every student submission and mark in them. Reassign their subjects to another lecturer instead; the account can stay.`,
          code: 'LECTURER_HAS_EXAMS',
          counts: { exams, adminActions },
        },
        { status: 409 }
      );
    }

    await prisma.user.delete({
      where: { id },
    });

    await recordAudit({ action: 'ADMIN_LECTURER_DELETED', category: 'ADMIN', actorId: session!.userId, actorRole: session!.role, targetType: 'User', targetId: id });
    return NextResponse.json({ message: 'Lecturer deleted successfully' });
  } catch (error: any) {
    console.error('[/api/admin/lecturers]', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
