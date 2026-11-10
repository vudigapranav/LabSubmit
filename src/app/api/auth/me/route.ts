import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  const { errorResponse, session } = await requireAuth(req);
  if (errorResponse) return errorResponse;

  try {
    const user = await prisma.user.findUnique({
      where: { id: session!.userId },
      select: {
        id: true,
        name: true,
        email: true,
        rollNumber: true,
        role: true,
        theme: true,
        lecturerProfile: true,
        studentProfile: {
          include: {
            branch: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ user });
  } catch (error: any) {
    console.error('[/api/auth/me]', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
