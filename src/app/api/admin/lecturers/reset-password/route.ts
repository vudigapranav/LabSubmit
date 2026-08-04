import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';

export async function POST(req: Request) {
  const { errorResponse } = requireAuth(req, ['ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const targetId = body.lecturerId || body.userId;
    const { newPassword } = body;

    if (!targetId || !newPassword) {
      return NextResponse.json({ error: 'Lecturer ID and new password are required' }, { status: 400 });
    }

    const lecturer = await prisma.user.findUnique({
      where: { id: targetId },
    });

    if (!lecturer || lecturer.role !== 'LECTURER') {
      return NextResponse.json({ error: 'Lecturer not found' }, { status: 404 });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: targetId },
      data: { password: hashedPassword },
    });

    return NextResponse.json({ message: `Password for ${lecturer.name} reset successfully` });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
