'use client';

import { useCallback, useRef } from 'react';

const DEBOUNCE_MS = 500;

export interface ViolationLogResult {
  logged: boolean;
  fullscreenExitCount?: number;
  autoSubmit?: boolean;
  alreadySubmitted?: boolean;
}

// Shared client-side debounced POST to /api/student/violations, used by both ExamGuard
// (fullscreen/focus/devtools events) and the clipboard-block path (AntiCheatWrapper via
// OnlineIDE) so the two don't duplicate the same fetch/debounce logic.
export function useViolationLogger(labId: string, token: string) {
  const lastEventRef = useRef<Record<string, number>>({});

  return useCallback(
    async (type: string, details?: string): Promise<ViolationLogResult | null> => {
      const now = Date.now();
      const last = lastEventRef.current[type] || 0;
      if (now - last < DEBOUNCE_MS) return null;
      lastEventRef.current[type] = now;

      try {
        const res = await fetch('/api/student/violations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ labId, type, details }),
        });
        if (!res.ok) return null;
        return await res.json();
      } catch (e) {
        console.error('Failed to log violation:', e);
        return null;
      }
    },
    [labId, token]
  );
}
