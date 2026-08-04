import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
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
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
