import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { defaultSectionConfig } from '../src/lib/answerSheet';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding CBIT LabSubmit database with Academic Hierarchy & Branch Ranges...');

  // Clean all existing data
  await prisma.sectionEvaluation.deleteMany();
  await prisma.executionRecord.deleteMany();
  await prisma.answerSheetResponse.deleteMany();
  await prisma.answerSheetSection.deleteMany();
  await prisma.questionSet.deleteMany();
  await prisma.examViolation.deleteMany();
  await prisma.submission.deleteMany();
  await prisma.labFile.deleteMany();
  await prisma.labWorkspace.deleteMany();
  await prisma.lab.deleteMany();
  await prisma.studentProfile.deleteMany();
  await prisma.subject.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.lecturerProfile.deleteMany();
  await prisma.user.deleteMany();

  const defaultPassword = await bcrypt.hash('password123', 10);
  const adminPassword = await bcrypt.hash('admin@123', 10);

  // 1. Admin Account
  const admin = await prisma.user.create({
    data: {
      email: 'admin@cbit.in',
      name: 'System Administrator',
      password: adminPassword,
      role: 'ADMIN',
      theme: 'light',
    },
  });

  // 2. Lecturer Accounts
  const lecturerRavi = await prisma.user.create({
    data: {
      email: 'ravi@cbit.in',
      name: 'Dr. Ravi',
      password: defaultPassword,
      role: 'LECTURER',
      lecturerProfile: { create: { department: 'Computer Science & Engineering', phone: '9876543210' } },
    },
  });

  const lecturerLakshmi = await prisma.user.create({
    data: {
      email: 'lakshmi@cbit.in',
      name: 'Mrs. Lakshmi',
      password: defaultPassword,
      role: 'LECTURER',
      lecturerProfile: { create: { department: 'Computer Science & Engineering', phone: '9876543211' } },
    },
  });

  const lecturerSuresh = await prisma.user.create({
    data: {
      email: 'suresh@cbit.in',
      name: 'Dr. Suresh',
      password: defaultPassword,
      role: 'LECTURER',
      lecturerProfile: { create: { department: 'Information Technology', phone: '9876543212' } },
    },
  });

  // 3. Branches with Configured Non-Overlapping Roll Number Ranges
  const cse1 = await prisma.branch.create({
    data: { name: 'CSE-1', year: 1, rollStart: '160126733001', rollEnd: '160126733060', isActive: true },
  });

  const year2Cse1 = await prisma.branch.create({
    data: { name: 'CSE-1', year: 2, rollStart: '160125733001', rollEnd: '160125733060', isActive: true },
  });

  const cse2 = await prisma.branch.create({
    data: { name: 'CSE-2', year: 2, rollStart: '160125733061', rollEnd: '160125733120', isActive: true },
  });

  const it2 = await prisma.branch.create({
    data: { name: 'IT-2', year: 2, rollStart: '160125737001', rollEnd: '160125737060', isActive: true },
  });

  const cse3 = await prisma.branch.create({
    data: { name: 'CSE-3', year: 3, rollStart: '160124733001', rollEnd: '160124733060', isActive: true },
  });

  // 4. Subjects & Lecturer Assignments
  const subC = await prisma.subject.create({
    data: {
      name: 'C & Data Structures Lab',
      code: 'CS101L',
      semester: 1,
      year: 1,
      branchId: cse1.id,
      lecturerId: lecturerRavi.id,
    },
  });

  const subJava = await prisma.subject.create({
    data: {
      name: 'Java Programming Lab',
      code: 'CS202L',
      semester: 4,
      year: 2,
      branchId: cse2.id,
      lecturerId: lecturerRavi.id,
    },
  });

  const subDBMS = await prisma.subject.create({
    data: {
      name: 'DBMS Lab',
      code: 'CS204L',
      semester: 4,
      year: 2,
      branchId: cse2.id,
      lecturerId: lecturerLakshmi.id,
    },
  });

  const subOS = await prisma.subject.create({
    data: {
      name: 'Operating Systems Lab',
      code: 'IT202L',
      semester: 4,
      year: 2,
      branchId: it2.id,
      lecturerId: lecturerSuresh.id,
    },
  });

  // 5. Student Account
  const studentRahul = await prisma.user.create({
    data: {
      email: 'rahul@cbit.in',
      name: 'Rahul Verma',
      rollNumber: '160125733078',
      password: defaultPassword,
      role: 'STUDENT',
      studentProfile: {
        create: {
          rollNumber: '160125733078',
          year: 2,
          branchId: cse2.id,
        },
      },
    },
  });

  // 6. Sample Programming Exams
  const now = new Date();

  // Every exam ships with the unified answer sheet in its default arrangement — the same
  // format a lecturer gets when they create one through the dashboard.
  const answerSheetSections = {
    create: defaultSectionConfig().map((s) => ({
      key: s.key,
      label: s.label,
      order: s.order,
      enabled: s.enabled,
      required: s.required,
      maxMarks: s.maxMarks,
      contentSource: s.contentSource,
    })),
  };

  const labJava1 = await prisma.lab.create({
    data: {
      title: 'Exam 1: Java Classes, Objects & Methods',
      description: 'Write a Java program to define a class BankAccount with methods for deposit and withdrawal.',
      problemStatement: 'Create a BankAccount class with attributes accountHolder and balance. Include deposit() and withdraw() methods.',
      year: 2,
      branchId: cse2.id,
      subjectId: subJava.id,
      lecturerId: lecturerRavi.id,
      allowCopy: false,
      allowPaste: false,
      allowCut: false,
      allowRightClick: false,
      allowDragDrop: false,
      examDate: now,
      startTime: new Date(now.getTime() - 15 * 60 * 1000), // started 15 minutes ago
      endTime: new Date(now.getTime() + 2 * 60 * 60 * 1000), // ends in 2 hours
      durationMinutes: 90,
      allowedLanguages: 'java',
      examModeEnabled: true,
      isPublished: true,
      fullscreenExitThreshold: 3,
      requireDesktopDevice: true,
      answerSheetSections,
    },
  });

  const labC1 = await prisma.lab.create({
    data: {
      title: 'Exam 2: C Arrays & Pointers',
      description: 'Solve a set of array and pointer manipulation problems in C.',
      problemStatement: 'Write a C program that reverses an array in-place using pointer arithmetic only.',
      year: 1,
      branchId: cse1.id,
      subjectId: subC.id,
      lecturerId: lecturerRavi.id,
      allowCopy: false,
      allowPaste: false,
      allowCut: false,
      allowRightClick: false,
      allowDragDrop: false,
      examDate: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      startTime: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      endTime: new Date(now.getTime() + 26 * 60 * 60 * 1000),
      durationMinutes: 60,
      allowedLanguages: 'c',
      examModeEnabled: true,
      isPublished: true,
      fullscreenExitThreshold: 3,
      requireDesktopDevice: true,
      answerSheetSections,
    },
  });

  const labJava2 = await prisma.lab.create({
    data: {
      title: 'Exam 3: Java Inheritance & Interfaces',
      description: 'Implement a small class hierarchy demonstrating inheritance and interfaces.',
      problemStatement: 'Design a Shape interface with area() and perimeter() methods, and implement Circle and Rectangle classes.',
      year: 2,
      branchId: cse2.id,
      subjectId: subJava.id,
      lecturerId: lecturerRavi.id,
      allowCopy: false,
      allowPaste: false,
      allowCut: false,
      allowRightClick: false,
      allowDragDrop: false,
      examDate: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      startTime: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      endTime: new Date(now.getTime() + 26 * 60 * 60 * 1000),
      durationMinutes: 60,
      allowedLanguages: 'java',
      examModeEnabled: true,
      isPublished: true,
      fullscreenExitThreshold: 3,
      requireDesktopDevice: true,
      answerSheetSections,
    },
  });

  console.log('Database successfully seeded!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
