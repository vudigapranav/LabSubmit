'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { Navbar } from '@/components/Navbar';
import { OnlineIDE } from '@/components/OnlineIDE';
import { ExamGuard } from '@/components/ExamGuard';
import { ProfileModal } from '@/components/ProfileModal';
import { ArrowLeft, BookOpen, AlertCircle, ShieldAlert, Maximize, Clock, CheckCircle2, Hourglass } from 'lucide-react';
import Link from 'next/link';

export default function StudentLabWorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const { user, token, loading } = useApp();

  const labId = params.id as string;
  const [labData, setLabData] = useState<any | null>(null);
  const [workspace, setWorkspace] = useState<any | null>(null);
  const [effectiveDeadline, setEffectiveDeadline] = useState<string | null>(null);
  const [loadingLab, setLoadingLab] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'STUDENT')) {
      router.push('/login');
    }
  }, [user, loading, router]);

  const fetchWorkspace = useCallback(async () => {
    try {
      const res = await fetch(`/api/student/workspace?labId=${labId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setLabData(data.lab);
        setWorkspace(data.workspace);
        setEffectiveDeadline(data.effectiveDeadline);
      } else {
        setLabData(null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingLab(false);
    }
  }, [labId, token]);

  useEffect(() => {
    if (token && labId) {
      fetchWorkspace();
    }
  }, [token, labId, fetchWorkspace]);

  const handleStartExam = async () => {
    setStartError(null);
    setStarting(true);

    // Fullscreen must be requested synchronously within this click handler's call chain —
    // browsers reject requests made after an awaited fetch resolves. Deliberately NOT
    // awaited here — some embedding contexts (or a denied/ignored permission) can leave
    // this promise pending forever, which must never block the actual exam start; if it's
    // denied or unsupported, ExamGuard's fullscreen-exit gate covers re-entry regardless.
    const el = document.documentElement;
    el.requestFullscreen?.().catch(() => {});

    try {
      const res = await fetch('/api/student/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'start_exam', labId }),
      });
      const data = await res.json();
      if (res.ok) {
        setWorkspace(data.workspace);
        setEffectiveDeadline(data.effectiveDeadline);
      } else {
        setStartError(data.error || 'Failed to start exam');
      }
    } catch (e) {
      setStartError('Server error starting exam');
    } finally {
      setStarting(false);
    }
  };

  const handleAutoSubmit = useCallback(async () => {
    try {
      await fetch('/api/student/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'submit_lab', labId }),
      });
    } catch (e) {
      console.error('Auto-submit failed:', e);
    } finally {
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
      fetchWorkspace();
    }
  }, [labId, token, fetchWorkspace]);

  if (loading || loadingLab) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white font-mono space-y-3">
        <div className="w-8 h-8 border-4 border-brand-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <span>Initializing CBIT Online IDE Workspace...</span>
      </div>
    );
  }

  if (!labData) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white space-y-4">
        <AlertCircle className="w-12 h-12 text-red-500" />
        <h2 className="text-xl font-bold">Programming Exam Not Found</h2>
        <Link href="/student" className="px-4 py-2 bg-brand-blue-600 rounded-xl text-xs font-bold text-white">
          Return to Student Dashboard
        </Link>
      </div>
    );
  }

  const hasStarted = Boolean(workspace?.startedAt);
  const isSubmitted = Boolean(workspace?.isSubmitted);

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col overflow-hidden">
      <Navbar onOpenProfile={() => setProfileOpen(true)} />

      {/* Back Bar */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2 flex items-center justify-between text-xs">
        <Link
          href="/student"
          className="flex items-center space-x-1 text-slate-400 hover:text-white font-semibold transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Dashboard</span>
        </Link>

        <div className="text-slate-400 font-mono">
          Faculty: <span className="text-slate-200 font-semibold">{labData.lecturer?.name}</span>
        </div>
      </div>

      {/* Gate: exam not started yet */}
      {!hasStarted && !isSubmitted && (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-8 space-y-5 shadow-2xl text-center">
            <div className="w-14 h-14 rounded-2xl bg-brand-olive-950/60 border border-brand-olive-800/60 flex items-center justify-center mx-auto">
              <BookOpen className="w-7 h-7 text-brand-olive-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{labData.title}</h2>
              <p className="text-xs text-slate-400 mt-1">{labData.description}</p>
            </div>

            {labData.status === 'RUNNING' ? (
              <>
                {labData.examModeEnabled && (
                  <div className="bg-amber-950/40 border border-amber-800/60 rounded-xl p-4 text-left space-y-2">
                    <div className="flex items-center space-x-2 text-amber-300 font-bold text-xs">
                      <ShieldAlert className="w-4 h-4" />
                      <span>Secure Exam Mode</span>
                    </div>
                    <ul className="text-[11px] text-amber-200/90 space-y-1 list-disc list-inside">
                      <li>Fullscreen will be enforced for the entire exam.</li>
                      <li>Exiting fullscreen, switching tabs, or opening dev tools is logged.</li>
                      <li>
                        Exceeding {labData.fullscreenExitThreshold} fullscreen exits auto-submits your exam.
                      </li>
                      <li>Copy, paste, and right-click are restricted per your instructor's settings.</li>
                      <li>This is your one and only submission attempt.</li>
                    </ul>
                  </div>
                )}

                {startError && (
                  <div className="text-xs text-red-400 bg-red-950/40 border border-red-800/60 rounded-lg p-2">
                    {startError}
                  </div>
                )}

                <button
                  onClick={handleStartExam}
                  disabled={starting}
                  className="w-full py-3 rounded-xl bg-brand-olive-700 hover:bg-brand-olive-600 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center space-x-2 transition-colors shadow-md"
                >
                  <Maximize className="w-4 h-4" />
                  <span>{starting ? 'Starting...' : 'Start Exam'}</span>
                </button>
              </>
            ) : labData.status === 'UPCOMING' ? (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 flex items-center justify-center space-x-2 text-slate-300 text-xs font-semibold">
                <Hourglass className="w-4 h-4" />
                <span>
                  This exam opens {labData.startTime ? new Date(labData.startTime).toLocaleString() : 'soon'}.
                </span>
              </div>
            ) : (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 flex items-center justify-center space-x-2 text-slate-300 text-xs font-semibold">
                <Clock className="w-4 h-4" />
                <span>This exam window has closed.</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Locked: already submitted */}
      {isSubmitted && (
        <div className="flex-1 p-2 sm:p-4 overflow-hidden flex flex-col">
          <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-xl p-3 mb-3 flex items-center space-x-2 text-emerald-300 text-xs font-semibold">
            <CheckCircle2 className="w-4 h-4" />
            <span>
              Exam submitted{workspace.autoSubmitted ? ' automatically' : ''}
              {workspace.submittedAt ? ` at ${new Date(workspace.submittedAt).toLocaleString()}` : ''}. Your code is
              read-only.
            </span>
          </div>
          <div className="flex-1 overflow-hidden">
            <OnlineIDE
              labId={labData.id}
              labTitle={labData.title}
              problemStatement={labData.problemStatement}
              readOnly={true}
              initialFiles={workspace?.files || []}
              isSubmitted={true}
            />
          </div>
        </div>
      )}

      {/* Active exam: exam-guard wrapped IDE */}
      {hasStarted && !isSubmitted && (
        <div className="flex-1 p-2 sm:p-4 overflow-hidden">
          <ExamGuard
            labId={labData.id}
            token={token || ''}
            examModeEnabled={labData.examModeEnabled}
            fullscreenExitThreshold={labData.fullscreenExitThreshold}
            initialFullscreenExitCount={workspace.fullscreenExitCount || 0}
            effectiveDeadline={effectiveDeadline}
            isSubmitted={isSubmitted}
            onAutoSubmit={handleAutoSubmit}
          >
            <OnlineIDE
              labId={labData.id}
              labTitle={labData.title}
              problemStatement={labData.problemStatement}
              readOnly={false}
              initialFiles={workspace?.files || []}
              isSubmitted={false}
              onSubmittedSuccess={fetchWorkspace}
              allowCopy={labData.allowCopy}
              allowPaste={labData.allowPaste}
              allowCut={labData.allowCut}
              allowRightClick={labData.allowRightClick}
              allowDragDrop={labData.allowDragDrop}
            />
          </ExamGuard>
        </div>
      )}

      <ProfileModal isOpen={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
