import { NextResponse } from 'next/server';
import { getTokenFromRequest, verifyToken, TokenPayload } from './jwt';

export function getAuthSession(req: Request): TokenPayload | null {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  return verifyToken(token);
}

export function requireAuth(req: Request, roles?: ('ADMIN' | 'LECTURER' | 'STUDENT')[]) {
  const session = getAuthSession(req);
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
