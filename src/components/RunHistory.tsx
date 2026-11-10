'use client';

// Faculty-facing run history for one submission: every program the student ran during the
// attempt, as recorded server-side by the execution engine. Its main job is to let an
// evaluator check the Output section against something that actually executed — before
// this, Input/Output were purely student-attested.
//
// Two views share one data hook and one detail renderer: the Runs tab of the Submission
// Inspector (RunHistory), and the console under the review IDE (RecordedRunsConsole), which
// puts the recorded runs where the student saw them — beneath the editor.
import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, ChevronDown, ChevronRight, FileCode, Terminal as TerminalIcon } from 'lucide-react';
import { Alert, Button, EmptyState, ErrorState, LoadingState, StatusBadge } from '@/components/ui';
import { compareRunSource, findMatchingRun, type SourceFileLike } from '@/lib/runTranscript';

export interface RecordedRunFile {
  filename: string;
  language: string;
  content: string;
}

export interface RecordedRun {
  id: string;
  filename: string;
  language: string;
  stdin: string;
  stdout: string;
  exitCode: number | null;
  durationMs: number | null;
  compileFailed: boolean;
  /** The source the engine compiled for this run; null when it was not recorded. */
  files: RecordedRunFile[] | null;
  createdAt: string;
}

const LANGUAGE_LABELS: Record<string, string> = {
  c: 'C',
  cpp: 'C++',
  java: 'Java',
  python: 'Python',
  javascript: 'JavaScript',
};
export const languageLabel = (lang: string) => LANGUAGE_LABELS[lang] || lang;

export function runOutcome(run: RecordedRun): { tone: 'emerald' | 'rose' | 'amber' | 'neutral'; label: string } {
  if (run.compileFailed) return { tone: 'rose', label: 'Compile error' };
  if (run.exitCode === null) return { tone: 'amber', label: 'Stopped' };
  if (run.exitCode === 0) return { tone: 'emerald', label: 'Exit 0' };
  if (run.exitCode === 124) return { tone: 'amber', label: 'Time limit' };
  if (run.exitCode === 137) return { tone: 'amber', label: 'Killed (exit 137)' };
  return { tone: 'rose', label: `Runtime error · exit ${run.exitCode}` };
}

/** Loads the recorded runs of one submission, newest first. */
export function useRecordedRuns(submissionId: string, token: string | null) {
  const [runs, setRuns] = useState<RecordedRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  return { runs, error, retry: () => setAttempt((n) => n + 1) };
}

const SURFACES = {
  light: {
    heading: 'text-slate-600 dark:text-slate-400',
    pre: 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200',
    meta: 'text-slate-500 dark:text-slate-400',
  },
  dark: {
    heading: 'text-slate-400',
    pre: 'bg-[#090d16] border-slate-800 text-slate-200',
    meta: 'text-slate-400',
  },
};

/**
 * One recorded run, in full: what it was, what was typed, what it printed, and which code it
 * ran. Never fills a gap with a guess — an unrecorded field says it was not recorded.
 */
export const RunDetail: React.FC<{
  run: RecordedRun;
  number: number;
  handInFiles?: SourceFileLike[];
  /** Offered when the run's source was recorded: show that source in the editor. */
  onViewSource?: (run: RecordedRun) => void;
  surface?: 'light' | 'dark';
}> = ({ run, number, handInFiles, onViewSource, surface = 'light' }) => {
  const s = SURFACES[surface];
  const o = runOutcome(run);
  const source = handInFiles ? compareRunSource(run.files, handInFiles) : 'unknown';
  return (
    <div className="space-y-3" aria-label={`Run ${number} details`}>
      <dl className={`flex flex-wrap gap-x-6 gap-y-2 text-[11px] ${s.meta}`}>
        <div>
          <dt className="font-semibold">Run</dt>
          <dd className="font-mono">#{number} · {run.filename}</dd>
        </div>
        <div>
          <dt className="font-semibold">Started</dt>
          <dd className="tabular">{new Date(run.createdAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt className="font-semibold">Language</dt>
          <dd>{languageLabel(run.language)}</dd>
        </div>
        <div>
          <dt className="font-semibold">Result</dt>
          <dd className="flex items-center gap-1.5 flex-wrap">
            <StatusBadge tone={o.tone}>{o.label}</StatusBadge>
            {run.durationMs !== null && <span className="tabular">{run.durationMs} ms</span>}
          </dd>
        </div>
      </dl>

      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        {source === 'same' && (
          <StatusBadge tone="emerald" icon={<CheckCircle2 className="w-3 h-3" aria-hidden="true" />}>
            Ran the same code as the hand-in
          </StatusBadge>
        )}
        {source === 'different' && (
          <StatusBadge tone="amber" icon={<AlertTriangle className="w-3 h-3" aria-hidden="true" />}>
            Ran different code from the hand-in
          </StatusBadge>
        )}
        {run.files === null && <span className={`italic ${s.meta}`}>Source for this run was not recorded.</span>}
        {run.files && onViewSource && (
          <Button size="sm" variant="secondary" onClick={() => onViewSource(run)}>
            <FileCode className="w-3.5 h-3.5" aria-hidden="true" />
            View this run&apos;s code in the editor
          </Button>
        )}
      </div>

      {!run.compileFailed && (
        <div>
          <h5 className={`text-[11px] font-bold mb-1 ${s.heading}`}>Input (stdin) typed by the student</h5>
          <pre className={`text-[11px] font-mono whitespace-pre-wrap border rounded-control p-2.5 ${s.pre}`}>
            {run.stdin || <span className="italic text-slate-400">(no input typed)</span>}
          </pre>
        </div>
      )}
      <div>
        <h5 className={`text-[11px] font-bold mb-1 ${s.heading}`}>
          {run.compileFailed
            ? 'Compiler errors'
            : 'Terminal output — stdout and stderr together, exactly as the student saw them (typed input is echoed)'}
        </h5>
        <pre className={`text-[11px] font-mono whitespace-pre-wrap max-h-72 overflow-auto border rounded-control p-2.5 ${s.pre}`}>
          {run.stdout || <span className="italic text-slate-400">(no output)</span>}
        </pre>
      </div>
    </div>
  );
};

export const RunHistory: React.FC<{
  submissionId: string;
  token: string | null;
  /** The student's Output section text, if the exam has one; compared against every run. */
  outputSectionText?: string | null;
  /** The handed-in files, so each run can say whether it ran the submitted code. */
  handInFiles?: SourceFileLike[];
}> = ({ submissionId, token, outputSectionText, handInFiles }) => {
  const { runs, error, retry } = useRecordedRuns(submissionId, token);
  const [open, setOpen] = useState<string | null>(null);

  if (error) {
    return <ErrorState title="Run history unavailable" description={error} action={<Button size="sm" variant="secondary" onClick={retry}>Retry</Button>} />;
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
            const o = runOutcome(run);
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
                  <div className="border-t border-slate-200 dark:border-slate-800 px-3 py-3">
                    <RunDetail run={run} number={numberOf(i)} handInFiles={handInFiles} />
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

/**
 * The student's recorded runs as a console under the review editor: run list on the left,
 * the selected run's input and output on the right. Opens on the latest run, so the
 * lecturer lands on what the student last saw rather than on an empty terminal.
 */
export const RecordedRunsConsole: React.FC<{
  submissionId: string;
  token: string | null;
  handInFiles: SourceFileLike[];
  onViewSource?: (run: RecordedRun, number: number) => void;
  onCount?: (count: number) => void;
}> = ({ submissionId, token, handInFiles, onViewSource, onCount }) => {
  const { runs, error, retry } = useRecordedRuns(submissionId, token);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (runs) onCount?.(runs.length);
  }, [runs, onCount]);

  if (error) {
    return (
      <div className="p-4 text-xs text-rose-300 flex items-center gap-3">
        <span>Run history unavailable: {error}</span>
        <button type="button" onClick={retry} className="px-2 py-1 rounded bg-slate-800 text-slate-200 hover:bg-slate-700">Retry</button>
      </div>
    );
  }
  if (!runs) return <p className="p-4 text-xs text-slate-400" aria-live="polite">Loading the student&apos;s runs…</p>;
  if (runs.length === 0) {
    return (
      <p className="p-4 text-xs text-slate-400">
        The student did not run any program during this attempt, or the attempt predates run recording. Nothing was recorded, so nothing is shown.
      </p>
    );
  }

  const numberOf = (i: number) => runs.length - i;
  const selectedIndex = Math.max(0, runs.findIndex((r) => r.id === selectedId));
  const selected = runs[selectedIndex];

  return (
    <div className="flex h-full min-h-0">
      <ol className="w-56 flex-shrink-0 border-r border-slate-800 overflow-y-auto py-1" aria-label="Student runs, newest first">
        {runs.map((run, i) => {
          const o = runOutcome(run);
          const active = i === selectedIndex;
          return (
            <li key={run.id}>
              <button
                type="button"
                onClick={() => setSelectedId(run.id)}
                aria-current={active ? 'true' : undefined}
                className={`w-full text-left px-3 py-1.5 text-[11px] font-mono flex flex-col gap-0.5 border-l-2 ${
                  active ? 'bg-slate-800 border-brand-olive-500 text-white' : 'border-transparent text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="font-bold tabular">#{numberOf(i)}</span>
                  <span className="truncate">{run.filename}</span>
                </span>
                <span className="flex items-center gap-1.5 font-sans">
                  <span className={o.tone === 'emerald' ? 'text-emerald-400' : o.tone === 'rose' ? 'text-rose-400' : 'text-amber-400'}>{o.label}</span>
                  <span className="text-slate-500 tabular">{new Date(run.createdAt).toLocaleTimeString()}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="flex-1 min-w-0 overflow-y-auto p-3">
        <RunDetail
          run={selected}
          number={numberOf(selectedIndex)}
          handInFiles={handInFiles}
          onViewSource={onViewSource ? (run) => onViewSource(run, numberOf(selectedIndex)) : undefined}
          surface="dark"
        />
      </div>
    </div>
  );
};
