import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { signToken } from '@/lib/jwt';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { identifier, password, role } = body; // identifier can be email or rollNumber

    if (!identifier || !password) {
      return NextResponse.json({ error: 'Please provide identifier and password' }, { status: 400 });
    }

    const trimmedIdentifier = identifier.trim();

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

    if (!user) {
      return NextResponse.json({ error: 'Invalid credentials or user not found' }, { status: 401 });
    }

    // Role check for STUDENT vs FACULTY login tabs
    if (role === 'STUDENT' && user.role !== 'STUDENT') {
      return NextResponse.json({ error: 'This account is not a student account. Please use Faculty Login.' }, { status: 403 });
    }
    if (role === 'FACULTY' && user.role === 'STUDENT') {
      return NextResponse.json({ error: 'Student accounts must use Student Login.' }, { status: 403 });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
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
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
