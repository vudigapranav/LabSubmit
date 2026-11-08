// Who may open an examination, and when its paper is released. Dependency-free.
// (SECURITY_AUDIT.md S13.)
//
// Before this, /api/student/workspace returned the problem statement of ANY published exam
// to ANY student — another branch, another year — and returned it while the exam was still
// UPCOMING, and before the student pressed Start. The last one is a timing bypass for
// per-student durations: read the paper for an hour, then start a full-length clock.

/**
 * The cohort rule — identical to how /api/student/labs builds a student's exam list:
 * same year, and same branch when both the exam and the student have one.
 */
export function studentInExamCohort(
  lab: { year: number; branchId: string | null },
  profile: { year: number; branchId: string | null } | null | undefined
): boolean {
  if (!profile) return false;
  if (lab.year !== profile.year) return false;
  if (lab.branchId && profile.branchId && lab.branchId !== profile.branchId) return false;
  return true;
}

/**
 * The paper (problem statement and questions) leaves the server only once the student's
 * own attempt has started — the same moment their clock starts — or after they submitted
 * (reviewing what you sat is submission history). Applies equally to exams with and without
 * question sets, so a pre-assigned set is not readable before Start either.
 */
export function examPaperReleased(workspace: { startedAt: Date | null; isSubmitted: boolean }): boolean {
  return Boolean(workspace.startedAt) || workspace.isSubmitted;
}
