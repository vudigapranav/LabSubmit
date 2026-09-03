// Pure exam-timing helpers — no prisma import, safe to use from both server routes/execution
// layer and client components (dashboards, ExamGuard) without pulling @prisma/client into
// client bundles.

export type ExamStatus = 'DRAFT' | 'UPCOMING' | 'RUNNING' | 'COMPLETED' | 'ARCHIVED';

export interface ExamTimingLab {
  isPublished: boolean;
  startTime: Date | string | null;
  endTime: Date | string | null;
  durationMinutes: number | null;
  examModeEnabled: boolean;
  allowedLanguages: string;
  /**
   * Set when the exam has been retired (see Lab.archivedAt). Optional so that every
   * existing caller — and any lab object assembled without it — keeps type-checking and
   * behaves exactly as before.
   */
  archivedAt?: Date | string | null;
}

export interface ExamTimingWorkspace {
  startedAt: Date | string | null;
  isSubmitted: boolean;
}

function toDate(value: Date | string | null): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

export function getExamStatus(lab: ExamTimingLab, now: Date = new Date()): ExamStatus {
  // Archived wins over every schedule-derived state. This is what stops an archived exam
  // being startable or runnable: both the workspace route and the execution engine's
  // authorizeRun already refuse anything that is not RUNNING, so retiring an exam closes
  // every attempt entry point at once rather than needing a new check at each of them.
  if (lab.archivedAt) return 'ARCHIVED';

  if (!lab.isPublished) return 'DRAFT';

  const start = toDate(lab.startTime);
  const end = toDate(lab.endTime);

  if (start && now < start) return 'UPCOMING';
  if (end && now > end) return 'COMPLETED';
  return 'RUNNING';
}

/**
 * A student's personal deadline is the earlier of the exam's overall end time
 * and their own startedAt + durationMinutes. If only one bound exists, that
 * bound is used. Returns null only when exam mode is disabled (legacy/non-exam lab).
 */
export function getEffectiveDeadline(lab: ExamTimingLab, workspace: ExamTimingWorkspace): Date | null {
  const end = toDate(lab.endTime);
  const startedAt = toDate(workspace.startedAt);

  const personalDeadline =
    startedAt && lab.durationMinutes
      ? new Date(startedAt.getTime() + lab.durationMinutes * 60_000)
      : null;

  if (end && personalDeadline) {
    return end < personalDeadline ? end : personalDeadline;
  }
  if (end) return end;
  if (personalDeadline) return personalDeadline;

  return lab.examModeEnabled ? null : null;
}

export const SUPPORTED_LANGUAGES = ['c', 'cpp', 'java', 'python'] as const;

export function parseAllowedLanguages(csv: string | null | undefined): string[] {
  if (!csv) return [...SUPPORTED_LANGUAGES];
  return csv
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function serializeAllowedLanguages(langs: string[]): string {
  const cleaned = langs.map((l) => l.trim().toLowerCase()).filter((l) => (SUPPORTED_LANGUAGES as readonly string[]).includes(l));
  return cleaned.length > 0 ? cleaned.join(',') : SUPPORTED_LANGUAGES.join(',');
}

export function isLanguageAllowed(lab: ExamTimingLab, language: string): boolean {
  return parseAllowedLanguages(lab.allowedLanguages).includes(language.toLowerCase());
}
