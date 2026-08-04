import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { signToken } from '@/lib/jwt';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, rollNumber, password, year } = body;

    if (!name || !rollNumber || !password || !year) {
      return NextResponse.json({ error: 'Name, roll number, password, and academic year are required.' }, { status: 400 });
    }

    const trimmedRoll = rollNumber.trim();
    const studentYear = parseInt(year);

    // 1. Roll Number Format Check (1601XXXXXXXX)
    const rollRegex = /^1601\d{8}$/;
    if (!rollRegex.test(trimmedRoll)) {
      return NextResponse.json(
        { error: 'Invalid Roll Number format. Roll Number must start with 1601 followed by 8 digits (e.g. 160125733001).' },
        { status: 400 }
      );
    }

    // 2. Already Registered Check
    const existingUser = await prisma.user.findFirst({
      where: { rollNumber: trimmedRoll },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'This Roll Number is already registered.' },
        { status: 400 }
      );
    }

    // 3. Automatic Branch Detection
    let studentRollBigInt: bigint;
    try {
      studentRollBigInt = BigInt(trimmedRoll);
    } catch (e) {
      return NextResponse.json({ error: 'Invalid Roll Number format.' }, { status: 400 });
    }

    const activeBranches = await prisma.branch.findMany({
      where: { year: studentYear, isActive: true },
    });

    let detectedBranch = null;

    for (const b of activeBranches) {
      if (b.rollStart && b.rollEnd) {
        try {
          const startRoll = BigInt(b.rollStart);
          const endRoll = BigInt(b.rollEnd);
          if (studentRollBigInt >= startRoll && studentRollBigInt <= endRoll) {
            detectedBranch = b;
            break;
          }
        } catch (e) {
          // ignore
        }
      }
    }

    if (!detectedBranch) {
      return NextResponse.json(
        { error: 'This roll number does not belong to any configured branch for the selected academic year. Please contact your administrator.' },
        { status: 400 }
      );
    }

    // 4. Create Student User & Profile
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
      data: {
        name: name.trim(),
        rollNumber: trimmedRoll,
        password: hashedPassword,
        role: 'STUDENT',
        studentProfile: {
          create: {
            rollNumber: trimmedRoll,
            year: studentYear,
            branchId: detectedBranch.id,
          },
        },
      },
      include: {
        studentProfile: {
          include: { branch: true },
        },
      },
    });

    const token = signToken({
      userId: newUser.id,
      role: 'STUDENT',
      rollNumber: newUser.rollNumber,
      name: newUser.name,
    });

    return NextResponse.json({
      message: 'Student registered successfully',
      detectedBranchName: detectedBranch.name,
      year: studentYear,
      token,
      user: {
        id: newUser.id,
        name: newUser.name,
        rollNumber: newUser.rollNumber,
        role: newUser.role,
        studentProfile: newUser.studentProfile,
      },
    });
  } catch (error: any) {
    console.error('Registration error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
