import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { checkPasswordPolicy } from '@/lib/passwordPolicy';
import { recordAudit, requestIp } from '@/lib/audit';
import bcrypt from 'bcryptjs';

export async function POST(req: Request) {
  const { errorResponse, session } = await requireAuth(req, ['ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const { userId, newPassword } = body;

    if (!userId || !newPassword) {
      return NextResponse.json({ error: 'Student user ID and new password are required' }, { status: 400 });
    }

    const student = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!student || student.role !== 'STUDENT') {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    }

    const passwordProblem = checkPasswordPolicy(newPassword);
    if (passwordProblem) {
      return NextResponse.json({ error: passwordProblem }, { status: 400 });
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    await recordAudit({ action: 'ADMIN_PASSWORD_RESET', category: 'ADMIN', actorId: session!.userId, actorRole: session!.role, targetType: 'User', targetId: userId });
    return NextResponse.json({ message: `Password for ${student.name} reset successfully` });
  } catch (error: any) {
    console.error('[/api/admin/students/reset-password]', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
