import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { signToken } from '@/lib/jwt';
import { clientAddress, loginAccountLimiter, loginAddressLimiter } from '@/lib/rateLimit';

// One message for "no such account" and "wrong password" — distinct messages told an
// attacker which roll numbers and emails exist (SECURITY_AUDIT.md S7).
const INVALID_CREDENTIALS = 'Invalid credentials. Check your login ID and password.';

// Compared against when the account does not exist, so an unknown identifier costs the
// same bcrypt time as a wrong password and response timing does not reveal existence.
const DUMMY_HASH = bcrypt.hashSync('labsubmit-timing-equaliser', 10);

function tooManyAttempts(retryAfter: number) {
  return NextResponse.json(
    { error: `Too many failed sign-in attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).` },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  );
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { identifier, password, role } = body; // identifier can be email or rollNumber

    if (!identifier || !password) {
      return NextResponse.json({ error: 'Please provide identifier and password' }, { status: 400 });
    }

    const trimmedIdentifier = String(identifier).trim();
    const accountKey = trimmedIdentifier.toLowerCase();
    const addressKey = clientAddress(req);

    // Checked before the password: while locked, even a correct password is refused,
    // otherwise the lock itself would confirm a correct guess.
    const retryAfter = Math.max(
      loginAccountLimiter.retryAfterSeconds(accountKey),
      loginAddressLimiter.retryAfterSeconds(addressKey)
    );
    if (retryAfter > 0) return tooManyAttempts(retryAfter);

    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: trimmedIdentifier.toLowerCase() },
          { rollNumber: trimmedIdentifier },
        ],
      },
      include: {
        lecturerProfile: true,
        studentProfile: {
          include: {
            branch: true,
          },
        },
      },
    });

    const isMatch = await bcrypt.compare(String(password), user?.password ?? DUMMY_HASH);
    if (!user || !isMatch) {
      loginAccountLimiter.recordFailure(accountKey);
      loginAddressLimiter.recordFailure(addressKey);
      return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
    }
    loginAccountLimiter.reset(accountKey);

    // Role check for STUDENT vs FACULTY login tabs — only after the password is proven, so
    // these helpful messages are shown to the account's owner, never to a guesser.
    if (role === 'STUDENT' && user.role !== 'STUDENT') {
      return NextResponse.json({ error: 'This account is not a student account. Please use Faculty Login.' }, { status: 403 });
    }
    if (role === 'FACULTY' && user.role === 'STUDENT') {
      return NextResponse.json({ error: 'Student accounts must use Student Login.' }, { status: 403 });
    }

    const token = signToken({
      userId: user.id,
      role: user.role as 'ADMIN' | 'LECTURER' | 'STUDENT',
      email: user.email,
      rollNumber: user.rollNumber,
      name: user.name,
    });

    return NextResponse.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        rollNumber: user.rollNumber,
        role: user.role,
        theme: user.theme,
        lecturerProfile: user.lecturerProfile,
        studentProfile: user.studentProfile,
      },
    });
  } catch (error: any) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Sign-in failed due to a server error. Please try again.' }, { status: 500 });
  }
}
