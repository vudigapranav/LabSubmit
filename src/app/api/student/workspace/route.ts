import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { detectLanguage } from '@/lib/compiler';
import { getExamStatus, getEffectiveDeadline, parseAllowedLanguages, isLanguageAllowed } from '@/lib/examTiming';
import { finalizeSubmission } from '@/lib/examSubmission';

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
      include: { files: { orderBy: { createdAt: 'asc' } } },
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
        include: { files: { orderBy: { createdAt: 'asc' } } },
      });
    }

    const submission = await prisma.submission.findFirst({
      where: { labId, studentId: session!.userId },
      orderBy: { submittedAt: 'desc' },
    });

    return NextResponse.json({
      lab: {
        ...lab,
        status: getExamStatus(lab),
        allowedLanguages: parseAllowedLanguages(lab.allowedLanguages),
      },
      workspace,
      submission,
      effectiveDeadline: getEffectiveDeadline(lab, workspace),
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
    const { action, labId, fileId, filename, content, newFilename, sessionId } = body;

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
      const updated = await prisma.labWorkspace.update({
        where: { id: workspace.id },
        data: {
          startedAt: workspace.startedAt ?? new Date(),
          // Claim the session slot on first start; a resumed session (workspace.sessionId
          // already set) keeps whichever session claimed it first — heartbeat detects any
          // second concurrent session from there rather than this action silently stealing it.
          ...(workspace.sessionId || !sessionId ? {} : { sessionId }),
          lastActivityAt: new Date(),
        },
        include: { files: { orderBy: { createdAt: 'asc' } } },
      });
      return NextResponse.json({
        message: 'Exam started',
        workspace: updated,
        effectiveDeadline: getEffectiveDeadline(lab, updated),
      });
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

    if (action === 'submit_lab') {
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
