import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(req: Request) {
  const { session } = await requireAuth(req);
  try {
    const body = await req.json();
    const { theme } = body;

    if (!theme || (theme !== 'light' && theme !== 'dark')) {
      return NextResponse.json({ error: 'Invalid theme value' }, { status: 400 });
    }

    if (session) {
      await prisma.user.update({
        where: { id: session.userId },
        data: { theme },
      });
    }

    return NextResponse.json({ success: true, theme });
  } catch (error: any) {
    console.error('[/api/profile/theme]', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
