import { NextResponse } from 'next/server';
import { getTokenFromRequest, verifyToken, TokenPayload } from './jwt';
import { prisma } from './db';

export function getAuthSession(req: Request): TokenPayload | null {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  return verifyToken(token);
}

export async function requireAuth(req: Request, roles?: ('ADMIN' | 'LECTURER' | 'STUDENT')[]) {
  const session = getAuthSession(req);
  // A signed token only proves who the caller WAS when it was issued (tokens live 7 days).
  // Without this lookup a deleted account — a removed lecturer, a deleted admin — kept full
  // API access until its token expired, and a changed role kept its old permissions.
  const account = session
    ? await prisma.user.findUnique({ where: { id: session.userId }, select: { role: true } })
    : null;
  if (session && (!account || account.role !== session.role)) {
    return {
      errorResponse: NextResponse.json({ error: 'Your session is no longer valid. Please sign in again.' }, { status: 401 }),
      session: null,
    };
  }
  if (!session) {
    return {
      errorResponse: NextResponse.json({ error: 'Unauthorized. Please login.' }, { status: 401 }),
      session: null,
    };
  }

  if (roles && !roles.includes(session.role)) {
    return {
      errorResponse: NextResponse.json({ error: 'Forbidden. Access denied.' }, { status: 403 }),
      session: null,
    };
  }

  return { errorResponse: null, session };
}
