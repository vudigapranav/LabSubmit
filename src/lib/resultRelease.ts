// Result release / publication policy — pure, no prisma import, so the same rule and the
// same wording serve the lecturer API route and the lecturer UI without pulling the
// database client into a browser bundle.
//
// PUBLICATION MODEL (and why it is shaped this way):
//
//   Submission.isPublished  — the authoritative per-record gate. Every student-facing
//                             path already filters on it, so it stays the single thing a
//                             student API has to check.
//   Lab.resultsReleasedAt   — the exam-level switch the lecturer actually operates, and
//                             the record of when the cohort was released.
//
// These are not two competing models. `resultsReleasedAt` is the switch; `isPublished` is
// how that switch is materialised onto the rows the student APIs read. Releasing an exam
// sets the timestamp and publishes its graded submissions in one transaction, so the two
// can never disagree.
//
// The rule that replaces the old client-supplied flag: whether a saved evaluation is
// published is DERIVED from the exam's release state on the server. Before release,
// saving a grade never publishes it. After release, a grade saved for a late or re-marked
// submission is published immediately — because the cohort has already been released, and
// silently withholding one student's mark while their classmates have theirs is the
// confusing case, not the safe one.

/** A submission's grading state, as far as release readiness is concerned. */
export interface ReleaseReadiness {
  /** Submitted attempts for this exam. */
  totalSubmissions: number;
  /** Submissions carrying a completed evaluation. */
  graded: number;
  /** Submissions still awaiting evaluation. */
  ungraded: number;
  /** Graded submissions whose marks the students can already see. */
  published: number;
}

export const NO_SUBMISSIONS: ReleaseReadiness = {
  totalSubmissions: 0,
  graded: 0,
  ungraded: 0,
  published: 0,
};

/**
 * Release is allowed only when every submitted attempt has been evaluated.
 *
 * Chosen deliberately over partial release: the lecturer presses one button for the whole
 * cohort, so a partial release would leave them believing everyone received a result when
 * only some did — exactly the failure the requirement calls out. A lecturer who genuinely
 * wants to release early can mark the remaining attempts first.
 */
export function canRelease(r: ReleaseReadiness): boolean {
  return r.totalSubmissions > 0 && r.ungraded === 0;
}

/** Why release is unavailable, or null when it is available. */
export function releaseBlockedReason(r: ReleaseReadiness): string | null {
  if (r.totalSubmissions === 0) {
    return 'There are no submitted attempts to release results for.';
  }
  if (r.ungraded > 0) {
    return `${r.ungraded} of ${r.totalSubmissions} submission${r.totalSubmissions === 1 ? '' : 's'} ${
      r.ungraded === 1 ? 'has' : 'have'
    } not been evaluated yet. Grade every submission before releasing results, so no student is left without one.`;
  }
  return null;
}

export type ReleaseState = 'RELEASED' | 'NOT_RELEASED';

export function releaseState(resultsReleasedAt: Date | string | null | undefined): ReleaseState {
  return resultsReleasedAt ? 'RELEASED' : 'NOT_RELEASED';
}

/** Badge wording, shared so the lecturer list and the dialog cannot drift apart. */
export const RELEASE_STATE_LABEL: Record<ReleaseState, string> = {
  RELEASED: 'Results released',
  NOT_RELEASED: 'Results not released',
};

/**
 * Exactly what releasing does. The API returns this and the confirmation dialog renders
 * it, so the UI can never promise something the implementation does not do. Each line is
 * true because release sets Lab.resultsReleasedAt and publishes the graded submissions —
 * and does nothing else.
 */
export const RELEASE_EFFECTS: string[] = [
  'Students can see the marks awarded for this examination',
  'Students can see the remarks written on their own submission',
  'Grades saved for this exam from now on are visible to that student immediately',
  'Releasing cannot be undone from the lecturer interface',
];

/** What a student is shown while results are withheld. One string, used server and client. */
export const RESULTS_WITHHELD_MESSAGE = 'Results not yet released';
