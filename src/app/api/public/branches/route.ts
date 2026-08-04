import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

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
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
