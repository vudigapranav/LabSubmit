import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  const { errorResponse } = requireAuth(req, ['ADMIN']);
  if (errorResponse) return errorResponse;

  try {
    const branches = await prisma.branch.findMany({
      orderBy: { year: 'asc' },
    });

    return NextResponse.json({ ranges: branches });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
