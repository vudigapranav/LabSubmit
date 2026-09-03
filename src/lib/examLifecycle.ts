// Exam deletion / archive policy — pure, no prisma import, so the same rules and the same
// wording are used by the lecturer API route and by the lecturer UI without pulling the
// database client into a browser bundle.
//
// The rule this module exists to enforce: an examination that students have actually
// touched can never be permanently deleted. Every relation on Lab cascades, so a delete
// takes the workspaces, submissions, awarded marks, integrity log, question sets and
// answer-sheet configuration with it. That is unacceptable once real student work exists,
// and the decision is made on the server — the client only asks this module what to render.

/** Action strings written to ExamAdminAction by the exam-lifecycle endpoints. */
export const EXAM_ADMIN_ACTIONS = {
  ARCHIVE: 'ARCHIVE_EXAM',
  UNARCHIVE: 'UNARCHIVE_EXAM',
  DELETE: 'DELETE_EXAM',
} as const;

/**
 * Everything a student could have created or been awarded under one exam. Counts only —
 * no names, no roll numbers: the lecturer needs to know that work exists and roughly how
 * much, not who it belongs to, in order to decide between deleting and archiving.
 */
export interface ExamActivity {
  /** Attempts that were actually started (a workspace alone means the page was opened). */
  startedAttempts: number;
  submissions: number;
  /** Submissions carrying a mark — the most expensive thing a delete would destroy. */
  gradedSubmissions: number;
  violations: number;
  /** Source files written by students during attempts. */
  files: number;
  /** Answer-sheet sections students have written into. */
  answerSheetResponses: number;
}

export const NO_ACTIVITY: ExamActivity = {
  startedAttempts: 0,
  submissions: 0,
  gradedSubmissions: 0,
  violations: 0,
  files: 0,
  answerSheetResponses: 0,
};

/**
 * Would a permanent delete destroy student work? Deliberately broad: any one of these
 * signals is enough to refuse. A workspace row on its own is not student work — one is
 * created the moment a student opens the exam page — so it is the *started* attempt, not
 * the workspace, that counts.
 */
export function hasStudentActivity(a: ExamActivity): boolean {
  return (
    a.startedAttempts > 0 ||
    a.submissions > 0 ||
    a.violations > 0 ||
    a.files > 0 ||
    a.answerSheetResponses > 0
  );
}

/** A short, human list of what exists, for the refusal message and the dialog. */
export function describeActivity(a: ExamActivity): string {
  const parts: string[] = [];
  if (a.startedAttempts > 0) parts.push(`${a.startedAttempts} started attempt${a.startedAttempts === 1 ? '' : 's'}`);
  if (a.submissions > 0) parts.push(`${a.submissions} submission${a.submissions === 1 ? '' : 's'}`);
  if (a.gradedSubmissions > 0) parts.push(`${a.gradedSubmissions} awarded mark${a.gradedSubmissions === 1 ? '' : 's'}`);
  if (a.violations > 0) parts.push(`${a.violations} integrity event${a.violations === 1 ? '' : 's'}`);
  if (parts.length === 0 && a.files > 0) parts.push(`${a.files} student file${a.files === 1 ? '' : 's'}`);
  if (parts.length === 0) return 'student work';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The refusal a lecturer sees when they try to delete an exam students have sat. */
export function deletionRefusalMessage(a: ExamActivity): string {
  return `Exam cannot be deleted because student attempts exist (${describeActivity(a)}). Archive it instead — archiving removes it from active workflows and keeps every record.`;
}

/**
 * Exactly what archiving preserves. This list is the single source of the claim: the API
 * returns it and the confirmation dialog renders it, so the UI can never promise something
 * the implementation does not do. Every line here is true because archiving writes one
 * timestamp on Lab and touches no other row.
 */
export const ARCHIVE_PRESERVES: string[] = [
  'Student submissions and the files submitted with them',
  'Awarded marks, remarks and evaluation status',
  'Evaluation history and who evaluated each submission',
  'Question sets, their questions and the student-to-set assignment',
  'Answer-sheet configuration and every answer written into it',
  'The integrity log for the examination',
];

/** What archiving actually changes, stated as plainly as what it preserves. */
export const ARCHIVE_EFFECTS: string[] = [
  'The exam stops appearing to students as active or upcoming',
  'No new attempt can be started, and no attempt in progress can continue',
  'Faculty keep full access for historical review and evaluation',
];

/**
 * The single decision the UI needs: which dialog to show. Mirrors the server's own rule so
 * the two cannot drift — but the client's copy of it is a convenience, never the guard.
 * The server re-derives this on every DELETE regardless of what the client believed.
 */
export type ExamDeletionOption = 'DELETE_ALLOWED' | 'ARCHIVE_INSTEAD';

export function deletionOption(a: ExamActivity): ExamDeletionOption {
  return hasStudentActivity(a) ? 'ARCHIVE_INSTEAD' : 'DELETE_ALLOWED';
}
