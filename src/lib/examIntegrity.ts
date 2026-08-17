// Pure helpers for the exam integrity event system — no prisma import, safe to use from
// both server routes and client components (Submission Inspector), mirroring examTiming.ts.

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type IntegrityStatus = 'NORMAL' | 'WARNING' | 'FLAGGED';

// The client's `type` selects the tier; severity is always looked up here server-side and
// never accepted from the client, so a student can't downgrade their own violation severity.
export const SEVERITY_BY_TYPE: Record<string, Severity> = {
  COPY_ATTEMPT: 'LOW',
  CUT_ATTEMPT: 'LOW',
  CONTEXT_MENU_ATTEMPT: 'LOW',
  SELECT_ALL_ATTEMPT: 'LOW',
  EXAM_TIMEOUT: 'LOW',
  PASTE_ATTEMPT: 'MEDIUM',
  WINDOW_BLUR: 'MEDIUM',
  VISIBILITY_HIDDEN: 'MEDIUM',
  FULLSCREEN_EXIT: 'MEDIUM',
  FULLSCREEN_ENTER: 'MEDIUM',
  DEVTOOLS_ATTEMPT: 'HIGH',
  DUPLICATE_SESSION: 'HIGH',
  // Defined for completeness — not currently emitted (see examIntegrity design notes):
  // attaching these to a specific student for an ordinary rejected request risks false
  // accusation, and the authorization layer already prevents the underlying outcomes.
  UNAUTHORIZED_EXAM_ACCESS: 'CRITICAL',
  UNAUTHORIZED_SUBMISSION: 'CRITICAL',
  SERVER_SECURITY_VIOLATION: 'CRITICAL',
};

export function severityForType(type: string): Severity {
  return SEVERITY_BY_TYPE[type] || 'LOW';
}

interface IntegrityEventLike {
  type: string;
  severity: string;
}

// EXAM_TIMEOUT is excluded from escalation — running out of time isn't misconduct, just a
// lifecycle event. Never label a student definitively ("CHEATER") — these are signals for
// faculty review, not verdicts.
export function deriveIntegrityStatus(
  events: IntegrityEventLike[],
  fullscreenExitCount: number,
  fullscreenExitThreshold: number
): IntegrityStatus {
  const relevant = events.filter((e) => e.type !== 'EXAM_TIMEOUT');

  const hasHighOrCritical = relevant.some((e) => e.severity === 'HIGH' || e.severity === 'CRITICAL');
  if (hasHighOrCritical || fullscreenExitCount >= fullscreenExitThreshold) {
    return 'FLAGGED';
  }

  if (relevant.length > 0 || fullscreenExitCount > 0) {
    return 'WARNING';
  }

  return 'NORMAL';
}
