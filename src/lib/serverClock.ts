// Server-time synchronisation for the exam countdown. Dependency-free (used by the browser).
//
// The deadline comes from the server, but the countdown used to subtract the BROWSER's clock.
// A laptop clock 15 minutes fast auto-submitted a student's exam with 10 real minutes left; a
// slow clock showed 25 minutes when the server would cut off at 10 (both reproduced in Chrome).
// The server remains the only authority on the deadline (it refuses work after it); this only
// makes what the student sees, and when the client triggers its own auto-submit, agree with it.

/**
 * Offset to add to the local clock to approximate the server's clock. Uses the midpoint of
 * the request's round trip as the moment the server stamped `serverNow` (the standard NTP
 * simplification), so network latency costs at most half the round trip in accuracy.
 */
export function estimateClockOffset(serverNowIso: string | undefined | null, sentAtMs: number, receivedAtMs: number): number | null {
  if (!serverNowIso) return null;
  const serverMs = Date.parse(serverNowIso);
  if (!Number.isFinite(serverMs) || receivedAtMs < sentAtMs) return null;
  return serverMs - (sentAtMs + (receivedAtMs - sentAtMs) / 2);
}

/** Milliseconds left until `deadlineIso` on the server's clock. */
export function serverRemainingMs(deadlineIso: string, offsetMs: number, localNowMs: number = Date.now()): number {
  return Date.parse(deadlineIso) - (localNowMs + offsetMs);
}
