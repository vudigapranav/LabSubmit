import jwt from 'jsonwebtoken';

function getJwtSecret(): string {
  return process.env.JWT_SECRET || 'cbit-labsubmit-super-secret-jwt-key-2026';
}

export interface TokenPayload {
  userId: string;
  role: 'ADMIN' | 'LECTURER' | 'STUDENT';
  email?: string | null;
  rollNumber?: string | null;
  name: string;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as TokenPayload;
  } catch (err) {
    return null;
  }
}

export function getTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }
  // Check cookie
  const cookieHeader = req.headers.get('cookie');
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').reduce((acc, c) => {
      const [key, val] = c.trim().split('=');
      if (key && val) acc[key] = val;
      return acc;
    }, {} as Record<string, string>);
    if (cookies.token) return cookies.token;
  }
  return null;
}
