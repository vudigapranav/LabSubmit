// Per-tab exam session identity, used for duplicate-session detection (see the heartbeat
// route). Stored in sessionStorage (not localStorage) so a same-tab refresh reuses the
// same id — never flagged as a duplicate — while a genuinely new tab/window gets a fresh
// id, which the backend correctly flags as a second concurrent session on the same attempt.
export function getOrCreateExamSessionId(labId: string): string {
  if (typeof window === 'undefined') return '';
  const key = `labsubmit_exam_session_${labId}`;
  let sessionId = window.sessionStorage.getItem(key);
  if (!sessionId) {
    sessionId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(key, sessionId);
  }
  return sessionId;
}
