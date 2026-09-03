import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { detectLanguage } from '@/lib/compiler';
import { getExamStatus, getEffectiveDeadline, parseAllowedLanguages, isLanguageAllowed } from '@/lib/examTiming';
import { finalizeSubmission } from '@/lib/examSubmission';
import { checkExamDevice } from '@/lib/deviceEligibility';
import { findIncompleteRequiredSections } from '@/lib/answerSheet';
import { assignableSets, chooseSetId, toStudentPaper, paperToPlainText } from '@/lib/questionSets';
import { initialFileForLab } from '@/lib/workspaceBootstrap';
import { RESULTS_WITHHELD_MESSAGE } from '@/lib/resultRelease';


/**
 * Picks the question set for a student's attempt. Random, but drawn from the sets that are
 * currently least used, so a cohort ends up evenly spread across the sets instead of a
 * uniform draw leaving one set barely used. Returns null when the exam has no sets, in
 * which case the exam's own problem statement is used and nothing changes for it.
 */
async function pickQuestionSetId(labId: string): Promise<string | null> {
  const sets = await prisma.questionSet.findMany({
    where: { labId, isActive: true },
    select: { id: true, label: true, isActive: true, questions: { select: { order: true, text: true, marks: true } } },
  });

  // An empty set would hand the student a blank paper, so it is never assignable.
  const eligible = assignableSets(sets);
  if (eligible.length === 0) return null;

  const usage = await prisma.labWorkspace.groupBy({
    by: ['questionSetId'],
    where: { labId, questionSetId: { not: null } },
    _count: { questionSetId: true },
  });
  const usageById = new Map(usage.map((u) => [u.questionSetId as string, u._count.questionSetId]));

  return chooseSetId(eligible, usageById);
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
        questionSet: { include: { questions: { orderBy: { order: 'asc' } } } },
      },
    });

    if (!workspace) {
      // Create initial workspace with a default file matching the exam's first allowed language.
      // Note: this does NOT start the exam clock — that only happens via the start_exam action.
      const boilerplate = initialFileForLab(lab.allowedLanguages);

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
          questionSet: { include: { questions: { orderBy: { order: 'asc' } } } },
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

    // The assigned set's questions stand in for the exam's own statement. Set identity —
    // label, id, how many sets exist — is never included in a student-facing payload; the
    // paper is built by toStudentPaper() from what a student may know, not by deleting
    // fields from the internal object.
    const assignableCount = await prisma.questionSet.count({
      where: { labId, isActive: true, questions: { some: {} } },
    });
    const paper = toStudentPaper(workspace.questionSet);
    const problemStatement = workspace.questionSet
      ? paperToPlainText(paper)
      : assignableCount > 0
        ? '' // sets exist but none assigned yet — withheld until the attempt starts
        : lab.problemStatement;

    // BOTH the joined set and the raw foreign key are stripped. questionSetId is not a
    // label, but it is a stable identifier two students could compare to discover they hold
    // the same paper — which is exactly what set identity is meant to hide.
    const { questionSet, questionSetId, ...workspaceForStudent } = workspace as typeof workspace & {
      questionSet: unknown;
    };

    // Exam content is withheld from an ineligible device, not merely hidden by the UI.
    // A phone must not be able to read the paper out of the API response and work on it
    // elsewhere, so questions, the problem statement and the source files never leave the
    // server unless the device may actually sit the exam.
    //
    // A SUBMITTED attempt is exempt: the examination is over, and reviewing what you
    // submitted is submission history, which the platform deliberately keeps available on
    // any device.
    const device = checkExamDevice(req, lab, 'START');
    const withholdExamContent = !device.eligible && !workspace.isSubmitted;

    return NextResponse.json({
      lab: {
        ...lab,
        problemStatement: withholdExamContent ? '' : problemStatement,
        status: getExamStatus(lab),
        allowedLanguages: parseAllowedLanguages(lab.allowedLanguages),
      },
      workspace: withholdExamContent ? { ...workspaceForStudent, files: [] } : workspaceForStudent,
      questions: withholdExamContent ? [] : paper,
      answerSheetSections: withholdExamContent ? [] : answerSheetSections,
      examContentWithheld: withholdExamContent,
      submission: toStudentSubmission(submission, lab.resultsReleasedAt),
      effectiveDeadline: getEffectiveDeadline(lab, workspace),
      // The gate the UI renders. The binding decision is re-made server-side on start_exam
      // and on every action inside the attempt; this response has already acted on it.
      deviceEligibility: device,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}

/**
 * The student's view of their own submission. Built from what a student may know rather
 * than by deleting fields off the Prisma row, so a column added to Submission later cannot
 * silently start leaking.
 *
 * Until the exam's results are released, a student may know THAT they submitted and when —
 * never the mark, the lecturer's remarks, the evaluation outcome, or who evaluated it. The
 * raw row was previously returned whole from both of this route's exits, which handed a
 * student their unpublished marks and their lecturer's private remarks for the asking.
 */
function toStudentSubmission(
  submission: { id: string; submittedAt: Date; status: string; marks: number | null; maxMarks: number; remarks: string | null; isPublished: boolean } | null,
  resultsReleasedAt: Date | null
) {
  if (!submission) return null;

  // Both gates must agree: the cohort has been released AND this row was published by that
  // release. Either alone is not enough.
  const released = resultsReleasedAt !== null && submission.isPublished;

  return {
    id: submission.id,
    submittedAt: submission.submittedAt,
    resultsReleased: released,
    // Withheld until release. `status` is included in the withholding because APPROVED or
    // REJECTED reveals the evaluation outcome just as surely as the number does.
    status: released ? submission.status : 'SUBMITTED',
    marks: released ? submission.marks : null,
    maxMarks: submission.maxMarks,
    remarks: released ? submission.remarks : null,
    resultsMessage: released ? null : RESULTS_WITHHELD_MESSAGE,
  };
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
        include: {
          files: { orderBy: { createdAt: 'asc' } },
          answerSheetResponses: true,
          questionSet: { include: { questions: { orderBy: { order: 'asc' } } } },
        },
      });

      const { questionSet, questionSetId: _assignedSetId, ...startedWorkspace } = updated;
      const startedPaper = toStudentPaper(questionSet);

      return NextResponse.json({
        message: 'Exam started',
        workspace: startedWorkspace,
        // Only the questions travel to the student — never which set they came from.
        questions: startedPaper,
        problemStatement: questionSet ? paperToPlainText(startedPaper) : lab.problemStatement,
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
        submission: toStudentSubmission(sub, lab.resultsReleasedAt),
      });
    }

    return NextResponse.json({ error: 'Invalid action specified' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
