import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';

export async function PUT(req: Request) {
  const { errorResponse, session } = requireAuth(req);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const { name, currentPassword, newPassword, phone, department, theme } = body;

    const user = await prisma.user.findUnique({
      where: { id: session!.userId },
      include: { lecturerProfile: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const updateData: any = {};
    if (name) updateData.name = name;
    if (theme) updateData.theme = theme;

    // Password change check
    if (newPassword) {
      if (!currentPassword) {
        return NextResponse.json({ error: 'Current password is required to update password' }, { status: 400 });
      }
      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return NextResponse.json({ error: 'Incorrect current password' }, { status: 400 });
      }
      updateData.password = await bcrypt.hash(newPassword, 10);
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: updateData,
    });

    // Update lecturer profile if applicable
    if (user.role === 'LECTURER' && (phone !== undefined || department !== undefined)) {
      await prisma.lecturerProfile.upsert({
        where: { userId: user.id },
        update: {
          phone: phone !== undefined ? phone : user.lecturerProfile?.phone,
          department: department !== undefined ? department : user.lecturerProfile?.department,
        },
        create: {
          userId: user.id,
          phone: phone || '',
          department: department || 'Computer Science & Engineering',
        },
      });
    }

    return NextResponse.json({
      message: 'Profile updated successfully',
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        rollNumber: updatedUser.rollNumber,
        role: updatedUser.role,
        theme: updatedUser.theme,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
