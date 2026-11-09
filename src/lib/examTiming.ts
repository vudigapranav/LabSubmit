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

// ── Exam window ─────────────────────────────────────────────────────────────────────────
// THE lifecycle rule (EXAM_LIFECYCLE_BUG_REPORT.md). Every status and deadline decision goes
// through getExamWindowEnd, so the dashboards, the workspace API and the execution engine can
// never disagree.
//
// The bug this replaces: status was derived from endTime alone and the duration was ignored.
// Nothing validated endTime against startTime, so an end time entered with an AM/PM slip
// (or equal to the start, or past midnight on the same date) was stored BEFORE the start —
// and the exam went straight from UPCOMING to COMPLETED the moment it began, whatever its
// duration. Reproduced on the Docker stack with 5- and 180-minute exams.

export const MAX_DURATION_MINUTES = 24 * 60;

/** The moment the exam window closes, or null for an open-ended (legacy, non-exam) lab. */
export function getExamWindowEnd(lab: Pick<ExamTimingLab, 'startTime' | 'endTime' | 'durationMinutes'>): Date | null {
  const start = toDate(lab.startTime);
  const end = toDate(lab.endTime);
  const duration = lab.durationMinutes && lab.durationMinutes > 0 ? lab.durationMinutes : null;
  // A configured end time counts only if it is actually after the start.
  if (end && (!start || end.getTime() > start.getTime())) return end;
  // Otherwise the window is start + duration — the configured duration is always respected.
  if (start && duration) return new Date(start.getTime() + duration * 60_000);
  // An end time at/before the start with no duration to fall back on cannot be repaired here;
  // keep it (the exam stays closed) and let scheduleProblem() tell the lecturer to fix it.
  return end;
}

/** True when `now` is at or past the deadline. One comparison for every caller. */
export function isPastDeadline(deadline: Date | null, now: Date = new Date()): boolean {
  return deadline !== null && now.getTime() >= deadline.getTime();
}

/**
 * Validates a schedule before it is stored. Shared by the lecturer form and the labs API so
 * the same rule is enforced on both sides. Returns a list of human-readable problems.
 */
export function validateExamSchedule(input: {
  startTime: Date | string | null | undefined;
  endTime: Date | string | null | undefined;
  durationMinutes: number | string | null | undefined;
  examModeEnabled: boolean;
}): string[] {
  const problems: string[] = [];
  const start = input.startTime ? toDate(input.startTime as Date | string) : null;
  const end = input.endTime ? toDate(input.endTime as Date | string) : null;
  const durationRaw = input.durationMinutes;
  const duration = durationRaw === null || durationRaw === undefined || durationRaw === '' ? null : Number(durationRaw);

  if ((start && isNaN(start.getTime())) || (end && isNaN(end.getTime()))) {
    problems.push('The exam date or time is not valid.');
    return problems;
  }
  if (duration !== null && (!Number.isInteger(duration) || duration < 1 || duration > MAX_DURATION_MINUTES)) {
    problems.push(`Duration must be a whole number of minutes between 1 and ${MAX_DURATION_MINUTES}.`);
  }
  if (start && end && end.getTime() <= start.getTime()) {
    problems.push('The end time must be after the start time. Check AM/PM — exams that run past midnight are not supported.');
  }
  if (input.examModeEnabled && !start) {
    problems.push('A start time is required for an exam.');
  }
  if (input.examModeEnabled && !end && duration === null) {
    problems.push('Give the exam an end time or a duration.');
  }
  if (start && end && duration !== null && end.getTime() > start.getTime()) {
    const windowMinutes = Math.round((end.getTime() - start.getTime()) / 60_000);
    if (windowMinutes < duration) {
      problems.push(`The exam window (${windowMinutes} min) is shorter than the duration (${duration} min); students would be cut off early. Extend the end time or shorten the duration.`);
    }
  }
  return problems;
}

/** For an already-stored exam: a warning the lecturer must see, or null. */
export function scheduleProblem(lab: Pick<ExamTimingLab, 'startTime' | 'endTime' | 'durationMinutes'>): string | null {
  const start = toDate(lab.startTime);
  const end = toDate(lab.endTime);
  if (start && end && end.getTime() <= start.getTime()) {
    return lab.durationMinutes
      ? `The stored end time is before the start time; the exam uses its ${lab.durationMinutes}-minute duration instead. Edit the schedule to fix it.`
      : 'The stored end time is before the start time, so this exam closes as soon as it starts. Edit the schedule.';
  }
  return null;
}

export function getExamStatus(lab: ExamTimingLab, now: Date = new Date()): ExamStatus {
  // Archived wins over every schedule-derived state. This is what stops an archived exam
  // being startable or runnable: both the workspace route and the execution engine's
  // authorizeRun already refuse anything that is not RUNNING, so retiring an exam closes
  // every attempt entry point at once rather than needing a new check at each of them.
  if (lab.archivedAt) return 'ARCHIVED';

  if (!lab.isPublished) return 'DRAFT';

  const start = toDate(lab.startTime);
  const end = getExamWindowEnd(lab);

  // UPCOMING: now < start.  RUNNING: start <= now < end.  COMPLETED: now >= end.
  if (start && now.getTime() < start.getTime()) return 'UPCOMING';
  if (isPastDeadline(end, now)) return 'COMPLETED';
  return 'RUNNING';
}

/**
 * A student's personal deadline is the earlier of the exam's overall end time
 * and their own startedAt + durationMinutes. If only one bound exists, that
 * bound is used. Returns null only when exam mode is disabled (legacy/non-exam lab).
 */
export function getEffectiveDeadline(lab: ExamTimingLab, workspace: ExamTimingWorkspace): Date | null {
  // The same window end the status uses — never the raw endTime.
  const end = getExamWindowEnd(lab);
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
