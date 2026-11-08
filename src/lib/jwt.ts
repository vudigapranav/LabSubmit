import jwt from 'jsonwebtoken';

// This string was the hardcoded fallback in earlier versions and is in the public git
// history, so a deployment that happens to use it is no better than one with no secret.
const PUBLISHED_FALLBACK_SECRET = 'cbit-labsubmit-super-secret-jwt-key-2026';

const MIN_RECOMMENDED_SECRET_LENGTH = 32;

/**
 * The single rule for whether the configured signing secret is usable. Throws with an
 * operator-facing message when it is not. Called on every sign/verify (the boundary on
 * Vercel, where there is no long-lived process to check at boot) and once at startup by
 * server.js (the Railway / local boundary), so a misconfigured host refuses to start instead
 * of looking healthy until the first login.
 *
 * Fail closed. With the old fallback, an unset JWT_SECRET silently meant "sign with a value
 * anyone can read" — anyone could mint an ADMIN token (SECURITY_AUDIT.md S5).
 */
export function assertJwtSecretConfigured(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || !secret.trim()) {
    throw new Error('JWT_SECRET is not set. Refusing to sign or verify tokens.');
  }
  if (secret === PUBLISHED_FALLBACK_SECRET) {
    throw new Error('JWT_SECRET is set to the publicly known legacy fallback value. Set a new random secret.');
  }
  return secret;
}

/**
 * Advisory only. A short secret is weaker, but refusing it would lock out any existing
 * deployment configured that way, and rotating it logs every user out — the operator's call.
 */
export function jwtSecretWarnings(): string[] {
  const secret = process.env.JWT_SECRET || '';
  return secret && secret.length < MIN_RECOMMENDED_SECRET_LENGTH
    ? [`JWT_SECRET is ${secret.length} characters; ${MIN_RECOMMENDED_SECRET_LENGTH}+ random characters are recommended (e.g. \`openssl rand -base64 48\`).`]
    : [];
}

function getJwtSecret(): string {
  return assertJwtSecretConfigured();
}

export interface TokenPayload {
  userId: string;
  role: 'ADMIN' | 'LECTURER' | 'STUDENT';
  email?: string | null;
  rollNumber?: string | null;
  name: string;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, getJwtSecret(), { algorithm: 'HS256', expiresIn: '7d' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    // Pin the algorithm so a token can never choose how it is verified.
    return jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as TokenPayload;
  } catch (err) {
    // A missing/invalid secret is a server misconfiguration, not a bad token: surface it
    // in the logs rather than letting it look like an ordinary 401.
    if (err instanceof Error && err.message.startsWith('JWT_SECRET')) console.error('[AUTH]', err.message);
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
