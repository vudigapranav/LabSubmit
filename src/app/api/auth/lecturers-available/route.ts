import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

// Was public, and served every lecturer's name and email to anyone (SECURITY_AUDIT.md S10).
// No page in the app calls it; kept for faculty/admin use rather than deleted.
export async function GET(req: Request) {
  const { errorResponse } = await requireAuth(req, ['ADMIN', 'LECTURER']);
  if (errorResponse) return errorResponse;

  try {
    const lecturers = await prisma.user.findMany({
      where: { role: 'LECTURER' },
      select: {
        id: true,
        name: true,
        email: true,
        lecturerProfile: true,
      },
    });

    const formattedLecturers = lecturers.map((lec) => ({
      id: lec.id,
      name: lec.name,
      email: lec.email,
      department: lec.lecturerProfile?.department || 'CSE',
    }));

    return NextResponse.json({ lecturers: formattedLecturers });
  } catch (error: any) {
    console.error('[/api/auth/lecturers-available]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
