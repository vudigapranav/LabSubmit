'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ShieldAlert, Maximize, Clock, AlertTriangle } from 'lucide-react';

type ViolationType =
  | 'FULLSCREEN_EXIT'
  | 'TAB_SWITCH'
  | 'WINDOW_BLUR'
  | 'VISIBILITY_HIDDEN'
  | 'DEVTOOLS_ATTEMPT'
  | 'CLIPBOARD_BLOCKED';

interface ExamGuardProps {
  labId: string;
  token: string;
  examModeEnabled: boolean;
  fullscreenExitThreshold: number;
  initialFullscreenExitCount: number;
  effectiveDeadline: string | null; // ISO timestamp from the server
  isSubmitted: boolean;
  onAutoSubmit: () => void; // parent performs the actual submit_lab call + UI lock
  children: React.ReactNode;
}

const DEBOUNCE_MS = 500;

function formatRemaining(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export const ExamGuard: React.FC<ExamGuardProps> = ({
  labId,
  token,
  examModeEnabled,
  fullscreenExitThreshold,
  initialFullscreenExitCount,
  effectiveDeadline,
  isSubmitted,
  onAutoSubmit,
  children,
}) => {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(
    typeof document !== 'undefined' ? Boolean(document.fullscreenElement) : true
  );
  const [exitCount, setExitCount] = useState<number>(initialFullscreenExitCount);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const autoSubmitFiredRef = useRef(false);
  const lastEventRef = useRef<Record<string, number>>({});

  const triggerAutoSubmit = useCallback(() => {
    if (autoSubmitFiredRef.current) return;
    autoSubmitFiredRef.current = true;
    onAutoSubmit();
  }, [onAutoSubmit]);

  const logViolation = useCallback(
    async (type: ViolationType, details?: string) => {
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
        const data = await res.json();
        if (typeof data.fullscreenExitCount === 'number') {
          setExitCount(data.fullscreenExitCount);
        }
        if (data.autoSubmit) {
          triggerAutoSubmit();
        }
        return data;
      } catch (e) {
        console.error('Failed to log violation:', e);
        return null;
      }
    },
    [labId, token, triggerAutoSubmit]
  );

  // Fullscreen enforcement
  useEffect(() => {
    if (!examModeEnabled || isSubmitted) return;

    const handleFullscreenChange = async () => {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);

      if (!active) {
        const data = await logViolation('FULLSCREEN_EXIT', 'Student exited fullscreen during exam');
        const nextCount = data?.fullscreenExitCount ?? exitCount + 1;

        if (nextCount >= fullscreenExitThreshold) {
          setToast('Fullscreen exit limit reached. Auto-submitting your exam.');
          triggerAutoSubmit();
        } else if (nextCount >= 2) {
          setToast('This activity has been recorded.');
        } else {
          setToast('You exited fullscreen.');
        }
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examModeEnabled, isSubmitted, fullscreenExitThreshold, logViolation, triggerAutoSubmit]);

  // Visibility / blur / focus / tab-switch detection (logged, not counted toward the
  // fullscreen-exit auto-submit threshold)
  useEffect(() => {
    if (!examModeEnabled || isSubmitted) return;

    const handleVisibility = () => {
      if (document.hidden) {
        logViolation('VISIBILITY_HIDDEN', 'Tab hidden or window minimized');
      }
    };
    const handleBlur = () => {
      logViolation('WINDOW_BLUR', 'Window lost focus');
    };
    const handleFocus = () => {
      // No violation on regaining focus — just informational.
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examModeEnabled, isSubmitted, logViolation]);

  // DevTools shortcut interception (F12 / Ctrl+Shift+I / Ctrl+Shift+J) — detects the
  // common shortcuts, not an already-open panel (no reliable cross-browser API for that).
  useEffect(() => {
    if (!examModeEnabled || isSubmitted) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const isDevtoolsShortcut =
        e.key === 'F12' ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key.toLowerCase() === 'i' || e.key.toLowerCase() === 'j' || e.key.toLowerCase() === 'c'));

      if (isDevtoolsShortcut) {
        e.preventDefault();
        e.stopPropagation();
        logViolation('DEVTOOLS_ATTEMPT', `Key combo: ${e.key}`);
        setToast('Developer tools shortcuts are disabled during this exam.');
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examModeEnabled, isSubmitted, logViolation]);

  // Countdown timer — ticks from the server-provided deadline, not an independently
  // tracked duration, so it self-corrects for background-tab throttling.
  useEffect(() => {
    if (!effectiveDeadline || isSubmitted) return;
    const deadline = new Date(effectiveDeadline).getTime();

    const tick = () => {
      const remaining = deadline - Date.now();
      setRemainingMs(remaining);
      if (remaining <= 0) {
        triggerAutoSubmit();
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [effectiveDeadline, isSubmitted, triggerAutoSubmit]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const handleReenterFullscreen = () => {
    document.documentElement.requestFullscreen?.().catch(() => {
      setToast('Could not re-enter fullscreen. Please allow fullscreen for this page.');
    });
  };

  const isLowTime = remainingMs !== null && remainingMs < 5 * 60 * 1000;

  return (
    <div className="relative w-full h-full">
      {/* Countdown timer */}
      {remainingMs !== null && !isSubmitted && (
        <div
          className={`fixed top-3 right-3 z-[70] px-3 py-1.5 rounded-xl border font-mono text-xs font-bold flex items-center space-x-1.5 shadow-lg ${
            isLowTime
              ? 'bg-red-950/90 border-red-700 text-red-200 animate-pulse'
              : 'bg-slate-900/95 border-slate-700 text-emerald-300'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>{formatRemaining(remainingMs)}</span>
        </div>
      )}

      {/* Transient toast for logged violations */}
      {toast && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-[70] max-w-md w-full px-4">
          <div className="bg-amber-900/95 border border-amber-700 text-amber-100 px-4 py-2.5 rounded-xl shadow-2xl flex items-center space-x-2 text-xs font-semibold">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-300" />
            <span>{toast}</span>
          </div>
        </div>
      )}

      {/* Blocking fullscreen-exit gate */}
      {examModeEnabled && !isFullscreen && !isSubmitted && (
        <div className="fixed inset-0 z-[80] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border-2 border-red-800 rounded-2xl max-w-md w-full p-8 text-center space-y-4 shadow-2xl">
            <ShieldAlert className="w-12 h-12 text-red-400 mx-auto" />
            <h3 className="text-white font-bold text-lg">Fullscreen Required</h3>
            <p className="text-slate-300 text-sm">
              You exited secure exam mode. This has been logged as violation{' '}
              <strong className="text-red-300">
                {exitCount}/{fullscreenExitThreshold}
              </strong>
              . Exceeding the limit will auto-submit your exam.
            </p>
            <button
              onClick={handleReenterFullscreen}
              className="w-full py-3 rounded-xl bg-red-700 hover:bg-red-600 text-white font-bold text-sm flex items-center justify-center space-x-2 transition-colors"
            >
              <Maximize className="w-4 h-4" />
              <span>Re-enter Fullscreen &amp; Resume</span>
            </button>
          </div>
        </div>
      )}

      {children}
    </div>
  );
};
