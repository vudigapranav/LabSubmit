import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { detectLanguage } from '@/lib/compiler';
import { getExamStatus, getEffectiveDeadline, parseAllowedLanguages, isLanguageAllowed } from '@/lib/examTiming';
import { finalizeSubmission } from '@/lib/examSubmission';
import { checkExamDevice } from '@/lib/deviceEligibility';
import { findIncompleteRequiredSections } from '@/lib/answerSheet';

const DEFAULT_BOILERPLATE: Record<string, { filename: string; content: string }> = {
  c: {
    filename: 'main.c',
    content: `#include <stdio.h>\n\nint main() {\n    printf("Welcome to CBIT Programming Exam!\\n");\n    return 0;\n}\n`,
  },
  cpp: {
    filename: 'main.cpp',
    content: `#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Welcome to CBIT Programming Exam!" << endl;\n    return 0;\n}\n`,
  },
  java: {
    filename: 'Main.java',
    content: `public class Main {\n    public static void main(String[] args) {\n        System.out.println("Welcome to CBIT Programming Exam!");\n    }\n}\n`,
  },
  python: {
    filename: 'main.py',
    content: `print("Welcome to CBIT Programming Exam!")\n`,
  },
};

/**
 * Picks the question set for a student's attempt. Random, but drawn from the sets that are
 * currently least used, so a cohort ends up evenly spread across the sets instead of a
 * uniform draw leaving one set barely used. Returns null when the exam has no sets, in
 * which case the exam's own problem statement is used and nothing changes for it.
 */
async function pickQuestionSetId(labId: string): Promise<string | null> {
  const sets = await prisma.questionSet.findMany({
    where: { labId, isActive: true },
    select: { id: true },
  });
  if (sets.length === 0) return null;

  const usage = await prisma.labWorkspace.groupBy({
    by: ['questionSetId'],
    where: { labId, questionSetId: { not: null } },
    _count: { questionSetId: true },
  });
  const usageById = new Map(usage.map((u) => [u.questionSetId as string, u._count.questionSetId]));

  const counts = sets.map((set) => usageById.get(set.id) || 0);
  const fewest = Math.min(...counts);
  const candidates = sets.filter((set, i) => counts[i] === fewest);

  return candidates[Math.floor(Math.random() * candidates.length)].id;
}

// GET workspace for lab
export async function GET(req: Request) {
  const { errorResponse, session } = requireAuth(req, ['STUDENT']);
  if (errorResponse) return errorResponse;

  try {
    const { searchParams } = new URL(req.url);
    const labId = searchParams.get('labId');

    if (!labId) {
      return NextResponse.json({ error: 'Exam ID is required' }, { status: 400 });
    }

    const lab = await prisma.lab.findUnique({
      where: { id: labId },
      include: { lecturer: { select: { name: true } } },
    });

    if (!lab || !lab.isPublished) {
      return NextResponse.json({ error: 'Exam not found' }, { status: 404 });
    }

    let workspace = await prisma.labWorkspace.findFirst({
      where: { labId, studentId: session!.userId },
      include: {
        files: { orderBy: { createdAt: 'asc' } },
        answerSheetResponses: true,
        questionSet: true,
      },
    });

    if (!workspace) {
      // Create initial workspace with a default file matching the exam's first allowed language.
      // Note: this does NOT start the exam clock — that only happens via the start_exam action.
      const allowed = parseAllowedLanguages(lab.allowedLanguages);
      const boilerplate = DEFAULT_BOILERPLATE[allowed[0]] || DEFAULT_BOILERPLATE.c;

      workspace = await prisma.labWorkspace.create({
        data: {
          labId,
          studentId: session!.userId,
          files: {
            create: [
              {
                filename: boilerplate.filename,
                language: detectLanguage(boilerplate.filename),
                content: boilerplate.content,
              },
            ],
          },
        },
        include: {
          files: { orderBy: { createdAt: 'asc' } },
          answerSheetResponses: true,
          questionSet: true,
        },
      });
    }

    const submission = await prisma.submission.findFirst({
      where: { labId, studentId: session!.userId },
      orderBy: { submittedAt: 'desc' },
    });

    const answerSheetSections = await prisma.answerSheetSection.findMany({
      where: { labId, enabled: true },
      orderBy: { order: 'asc' },
    });

    // The assigned set's statement stands in for the exam's own, and the set's identity
    // (its label, and how many sets exist) is never included in a student-facing payload.
    const hasQuestionSets = (await prisma.questionSet.count({ where: { labId, isActive: true } })) > 0;
    const problemStatement = workspace.questionSet
      ? workspace.questionSet.problemStatement
      : hasQuestionSets
        ? '' // sets exist but none assigned yet — withheld until the attempt starts
        : lab.problemStatement;

    const { questionSet, ...workspaceForStudent } = workspace as typeof workspace & { questionSet: unknown };

    return NextResponse.json({
      lab: {
        ...lab,
        problemStatement,
        status: getExamStatus(lab),
        allowedLanguages: parseAllowedLanguages(lab.allowedLanguages),
      },
      workspace: workspaceForStudent,
      answerSheetSections,
      submission,
      effectiveDeadline: getEffectiveDeadline(lab, workspace),
      // Advisory for the pre-exam gate; the binding decision is re-made server-side on
      // start_exam and on every action inside the attempt.
      deviceEligibility: checkExamDevice(req, lab, 'START'),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}

// POST actions: start_exam, create_file, save_file, rename_file, delete_file, submit_lab
export async function POST(req: Request) {
  const { errorResponse, session } = requireAuth(req, ['STUDENT']);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const { action, labId, fileId, filename, content, newFilename, sessionId, sectionId, deviceClass } = body;

    if (!labId || !action) {
      return NextResponse.json({ error: 'Exam ID and action are required' }, { status: 400 });
    }

    const lab = await prisma.lab.findUnique({ where: { id: labId } });
    if (!lab) {
      return NextResponse.json({ error: 'Exam not found' }, { status: 404 });
    }

    const workspace = await prisma.labWorkspace.findFirst({
      where: { labId, studentId: session!.userId },
      include: { files: true },
    });

    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    if (action === 'start_exam') {
      if (!lab.isPublished) {
        return NextResponse.json({ error: 'Exam is not currently available.' }, { status: 403 });
      }
      if (workspace.isSubmitted) {
        return NextResponse.json({ error: 'This exam has already been submitted.' }, { status: 403 });
      }
      const status = getExamStatus(lab);
      if (status !== 'RUNNING') {
        return NextResponse.json({ error: `Exam is not currently active (status: ${status}).` }, { status: 403 });
      }

      // Exam-device restriction, decided from request headers. Fails closed here: an
      // attempt that never starts on an ineligible device can never be continued on one.
      const startDevice = checkExamDevice(req, lab, 'START', deviceClass);
      if (!startDevice.eligible) {
        return NextResponse.json(
          { error: startDevice.reason, deviceBlocked: true, deviceClass: startDevice.deviceClass },
          { status: 403 }
        );
      }

      const assignedQuestionSetId = workspace.questionSetId ?? (await pickQuestionSetId(labId));

      const updated = await prisma.labWorkspace.update({
        where: { id: workspace.id },
        data: {
          startedAt: workspace.startedAt ?? new Date(),
          ...(assignedQuestionSetId ? { questionSetId: assignedQuestionSetId } : {}),
          startDeviceClass: workspace.startDeviceClass ?? startDevice.deviceClass,
          startUserAgent: workspace.startUserAgent ?? (startDevice.userAgent || '').slice(0, 512),
          // Claim the session slot on first start; a resumed session (workspace.sessionId
          // already set) keeps whichever session claimed it first — heartbeat detects any
          // second concurrent session from there rather than this action silently stealing it.
          ...(workspace.sessionId || !sessionId ? {} : { sessionId }),
          lastActivityAt: new Date(),
        },
        include: { files: { orderBy: { createdAt: 'asc' } }, answerSheetResponses: true, questionSet: true },
      });

      const { questionSet, ...startedWorkspace } = updated;

      return NextResponse.json({
        message: 'Exam started',
        workspace: startedWorkspace,
        // Only the statement travels to the student — never which set it came from.
        problemStatement: questionSet ? questionSet.problemStatement : lab.problemStatement,
        effectiveDeadline: getEffectiveDeadline(lab, updated),
      });
    }

    // Every action inside a live attempt re-checks the device. CONTINUE phase blocks only
    // a positively identified phone or tablet, so an unrecognised-but-desktop browser can
    // never strand a student halfway through their paper.
    const device = checkExamDevice(req, lab, 'CONTINUE', deviceClass);
    if (!device.eligible) {
      return NextResponse.json(
        { error: device.reason, deviceBlocked: true, deviceClass: device.deviceClass },
        { status: 403 }
      );
    }

    // Every other action requires an already-submitted lock check and a live deadline check.
    if (workspace.isSubmitted && action !== 'view') {
      return NextResponse.json(
        { error: 'Exam has already been submitted. Modifications are locked.' },
        { status: 403 }
      );
    }

    // Lazy deadline enforcement: self-heals workspace state on every touch, independent of
    // whether any client-side timer/violation call ever fires.
    const deadline = getEffectiveDeadline(lab, workspace);
    if (deadline && new Date() > deadline && action !== 'submit_lab') {
      await finalizeSubmission(prisma, {
        workspaceId: workspace.id,
        labId,
        studentId: session!.userId,
        auto: true,
        reason: 'TIMEOUT',
      });
      return NextResponse.json({ error: 'Exam time has expired. Your work has been auto-submitted.' }, { status: 403 });
    }

    if (action === 'create_file') {
      if (!filename) {
        return NextResponse.json({ error: 'Filename is required' }, { status: 400 });
      }
      const existing = workspace.files.find((f) => f.filename.toLowerCase() === filename.trim().toLowerCase());
      if (existing) {
        return NextResponse.json({ error: `File with name "${filename}" already exists` }, { status: 400 });
      }
      const lang = detectLanguage(filename);
      if (!isLanguageAllowed(lab, lang)) {
        return NextResponse.json({ error: `Language "${lang}" is not permitted for this exam.` }, { status: 400 });
      }
      const newFile = await prisma.labFile.create({
        data: {
          workspaceId: workspace.id,
          filename: filename.trim(),
          content: content || '// Start writing your code here\n',
          language: lang,
        },
      });
      return NextResponse.json({ message: 'File created', file: newFile });
    }

    if (action === 'save_file') {
      if (!fileId || content === undefined) {
        return NextResponse.json({ error: 'File ID and content are required' }, { status: 400 });
      }
      const updatedFile = await prisma.labFile.update({
        where: { id: fileId },
        data: { content },
      });
      return NextResponse.json({ message: 'File saved', file: updatedFile });
    }

    if (action === 'rename_file') {
      if (!fileId || !newFilename) {
        return NextResponse.json({ error: 'File ID and new filename are required' }, { status: 400 });
      }
      const lang = detectLanguage(newFilename);
      if (!isLanguageAllowed(lab, lang)) {
        return NextResponse.json({ error: `Language "${lang}" is not permitted for this exam.` }, { status: 400 });
      }
      const updatedFile = await prisma.labFile.update({
        where: { id: fileId },
        data: { filename: newFilename.trim(), language: lang },
      });
      return NextResponse.json({ message: 'File renamed', file: updatedFile });
    }

    if (action === 'delete_file') {
      if (!fileId) {
        return NextResponse.json({ error: 'File ID is required' }, { status: 400 });
      }
      if (workspace.files.length <= 1) {
        return NextResponse.json({ error: 'Workspace must contain at least one file.' }, { status: 400 });
      }
      await prisma.labFile.delete({
        where: { id: fileId },
      });
      return NextResponse.json({ message: 'File deleted' });
    }

    if (action === 'save_section') {
      if (!sectionId) {
        return NextResponse.json({ error: 'Section ID is required' }, { status: 400 });
      }

      // The section must belong to THIS exam and be switched on — a client cannot write
      // into another exam's sheet, or into a section the lecturer disabled.
      const section = await prisma.answerSheetSection.findFirst({
        where: { id: sectionId, labId, enabled: true },
      });
      if (!section) {
        return NextResponse.json({ error: 'Answer sheet section not found for this exam.' }, { status: 404 });
      }
      if (section.contentSource === 'CODE_FILES') {
        return NextResponse.json(
          { error: 'The Code section is taken from your source files and cannot be typed into.' },
          { status: 400 }
        );
      }

      const saved = await prisma.answerSheetResponse.upsert({
        where: { workspaceId_sectionId: { workspaceId: workspace.id, sectionId } },
        create: { workspaceId: workspace.id, sectionId, content: content ?? '' },
        update: { content: content ?? '' },
      });

      return NextResponse.json({ message: 'Answer sheet saved', response: saved });
    }

    if (action === 'submit_lab') {
      // Mandatory sections are enforced on a MANUAL submit only. A timeout or a
      // fullscreen-threshold auto-submit goes through finalizeSubmission directly and is
      // never blocked by this — an incomplete sheet must still be captured and evaluated.
      const enabledSections = await prisma.answerSheetSection.findMany({
        where: { labId, enabled: true },
        orderBy: { order: 'asc' },
      });

      if (enabledSections.length > 0) {
        const responses = await prisma.answerSheetResponse.findMany({ where: { workspaceId: workspace.id } });
        const missing = findIncompleteRequiredSections(enabledSections, responses, workspace.files);

        if (missing.length > 0) {
          return NextResponse.json(
            {
              error: `Your answer sheet is incomplete. Please fill in: ${missing.join(', ')}.`,
              incompleteSections: missing,
            },
            { status: 400 }
          );
        }
      }

      const sub = await finalizeSubmission(prisma, {
        workspaceId: workspace.id,
        labId,
        studentId: session!.userId,
        auto: false,
      });

      return NextResponse.json({
        message: 'Exam submitted successfully! Your workspace is now locked.',
        submission: sub,
      });
    }

    return NextResponse.json({ error: 'Invalid action specified' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
