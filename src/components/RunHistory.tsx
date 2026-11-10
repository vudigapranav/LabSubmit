'use client';

// Faculty-facing run history for one submission: every program the student ran during the
// attempt, as recorded server-side by the execution engine. Its main job is to let an
// evaluator check the Output section against something that actually executed — before
// this, Input/Output were purely student-attested.
import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, ChevronDown, ChevronRight, Terminal as TerminalIcon } from 'lucide-react';
import { Alert, Button, EmptyState, ErrorState, LoadingState, StatusBadge } from '@/components/ui';
import { findMatchingRun } from '@/lib/runTranscript';

export interface RecordedRun {
  id: string;
  filename: string;
  language: string;
  stdin: string;
  stdout: string;
  exitCode: number | null;
  durationMs: number | null;
  compileFailed: boolean;
  createdAt: string;
}

function outcome(run: RecordedRun): { tone: 'emerald' | 'rose' | 'amber' | 'neutral'; label: string } {
  if (run.compileFailed) return { tone: 'rose', label: 'Compile error' };
  if (run.exitCode === null) return { tone: 'amber', label: 'Stopped' };
  if (run.exitCode === 0) return { tone: 'emerald', label: 'Exit 0' };
  if (run.exitCode === 124) return { tone: 'amber', label: 'Time limit' };
  return { tone: 'rose', label: `Exit ${run.exitCode}` };
}

export const RunHistory: React.FC<{
  submissionId: string;
  token: string | null;
  /** The student's Output section text, if the exam has one; compared against every run. */
  outputSectionText?: string | null;
}> = ({ submissionId, token, outputSectionText }) => {
  const [runs, setRuns] = useState<RecordedRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setRuns(null);
    setError(null);
    fetch(`/api/lecturer/executions?submissionId=${encodeURIComponent(submissionId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setError(data.error || 'Could not load run history.');
        else setRuns(data.runs || []);
      })
      .catch(() => !cancelled && setError('Could not reach the server.'));
    return () => {
      cancelled = true;
    };
  }, [submissionId, token, attempt]);

  if (error) {
    return <ErrorState title="Run history unavailable" description={error} action={<Button size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>Retry</Button>} />;
  }
  if (!runs) return <LoadingState label="Loading run history…" />;

  // Runs are newest first; number them chronologically so "run #1" means the first run.
  const numberOf = (i: number) => runs.length - i;
  const hasOutputSection = typeof outputSectionText === 'string';
  const matchIndex = hasOutputSection
    ? findMatchingRun(outputSectionText!, runs.filter((r) => !r.compileFailed).map((r) => r.stdout))
    : -1;
  const matchedRun = matchIndex >= 0 ? runs.filter((r) => !r.compileFailed)[matchIndex] : null;

  return (
    <div className="space-y-3">
      {hasOutputSection &&
        (!outputSectionText!.trim() ? (
          <Alert tone="info" title="Output section is blank">Nothing to compare against the recorded runs.</Alert>
        ) : matchedRun ? (
          <Alert tone="success" title="Output section matches a recorded run">
            The Output section is exactly what run #{numberOf(runs.indexOf(matchedRun))} printed ({matchedRun.filename}, {new Date(matchedRun.createdAt).toLocaleTimeString()}).
          </Alert>
        ) : (
          <Alert tone="warning" title="Output section does not match any recorded run">
            The text may have been edited or typed by hand. Compare it with the runs below before relying on it.
          </Alert>
        ))}

      {runs.length === 0 ? (
        <EmptyState
          icon={<TerminalIcon className="w-5 h-5" aria-hidden="true" />}
          title="No recorded runs"
          description="The student did not run any program during this attempt, or the attempt predates run recording."
        />
      ) : (
        <ol className="space-y-2" aria-label="Recorded program runs, newest first">
          {runs.map((run, i) => {
            const o = outcome(run);
            const expanded = open === run.id;
            const isMatch = run === matchedRun;
            return (
              <li key={run.id} className="border border-slate-200 dark:border-slate-800 rounded-card bg-white dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : run.id)}
                  aria-expanded={expanded}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left flex-wrap"
                >
                  {expanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />}
                  <span className="text-xs font-bold text-slate-900 dark:text-white tabular">#{numberOf(i)}</span>
                  <span className="text-xs font-mono text-slate-700 dark:text-slate-300">{run.filename}</span>
                  <StatusBadge tone={o.tone}>{o.label}</StatusBadge>
                  {isMatch && (
                    <StatusBadge tone="olive" icon={<CheckCircle2 className="w-3 h-3" aria-hidden="true" />}>
                      Matches Output section
                    </StatusBadge>
                  )}
                  <span className="ml-auto text-[11px] text-slate-500 tabular">
                    {new Date(run.createdAt).toLocaleTimeString()}
                    {run.durationMs !== null && ` · ${run.durationMs} ms`}
                  </span>
                </button>
                {expanded && (
                  <div className="border-t border-slate-200 dark:border-slate-800 px-3 py-3 space-y-3">
                    {!run.compileFailed && (
                      <div>
                        <h5 className="text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">Input typed</h5>
                        <pre className="text-[11px] font-mono whitespace-pre-wrap bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-control p-2.5 text-slate-800 dark:text-slate-200">
                          {run.stdin || <span className="italic text-slate-400">(none)</span>}
                        </pre>
                      </div>
                    )}
                    <div>
                      <h5 className="text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                        {run.compileFailed ? 'Compiler output' : 'Terminal transcript (program output, input echoed)'}
                      </h5>
                      <pre className="text-[11px] font-mono whitespace-pre-wrap max-h-72 overflow-auto bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-control p-2.5 text-slate-800 dark:text-slate-200">
                        {run.stdout || <span className="italic text-slate-400">(no output)</span>}
                      </pre>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {runs.length > 0 && !matchedRun && hasOutputSection && outputSectionText!.trim() && (
        <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" aria-hidden="true" /> Matching ignores trailing spaces and line endings only.
        </p>
      )}
    </div>
  );
};
