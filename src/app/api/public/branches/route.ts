import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// Reads query parameters, so it can never be pre-rendered. Saying so stops `next build`
// attempting a static render whose internal signal the catch below would log as an error.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const yearStr = searchParams.get('year');

    const whereClause: any = { isActive: true };
    if (yearStr) {
      whereClause.year = parseInt(yearStr);
    }

    const branches = await prisma.branch.findMany({
      where: whereClause,
      orderBy: [{ year: 'asc' }, { name: 'asc' }],
    });

    return NextResponse.json({ branches });
  } catch (error: any) {
    console.error('[/api/public/branches]', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
