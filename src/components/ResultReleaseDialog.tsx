'use client';

import React from 'react';
import { Alert, Button, Modal } from '@/components/ui';
import { Send, ShieldAlert } from 'lucide-react';
import {
  RELEASE_EFFECTS,
  ReleaseReadiness,
  canRelease,
  releaseBlockedReason,
} from '@/lib/resultRelease';

/**
 * Confirmation for releasing an examination's results to its cohort.
 *
 * Release is irreversible from the lecturer interface, and it is the moment marks stop
 * being private, so the dialog states both plainly rather than asking "are you sure?".
 * When grading is incomplete it does not offer the action at all — it says how many
 * submissions are still unevaluated, which is the thing the lecturer has to fix.
 *
 * The server re-checks the same rule on every request; this component choosing wrongly
 * results in a 409, never in a partial release.
 */
interface Props {
  open: boolean;
  onClose: () => void;
  examTitle: string;
  readiness: ReleaseReadiness;
  busy?: boolean;
  /** Server refusal text, shown when a release attempt came back 409. */
  serverRefusal?: string | null;
  onConfirm: () => void;
}

export const ResultReleaseDialog: React.FC<Props> = ({
  open,
  onClose,
  examTitle,
  readiness,
  busy = false,
  serverRefusal,
  onConfirm,
}) => {
  const blocked = !canRelease(readiness) || Boolean(serverRefusal);
  const reason = serverRefusal || releaseBlockedReason(readiness);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Release results?"
      description={
        blocked
          ? 'Results cannot be released yet.'
          : 'Students will be able to see their marks for this examination.'
      }
      size="md"
      /* An irreversible, cohort-wide action must not be resolved by a stray click. */
      dismissOnBackdrop={false}
      footer={
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {blocked ? 'Close' : 'Cancel'}
          </Button>
          {!blocked && (
            <Button variant="primary" loading={busy} onClick={onConfirm}>
              <Send className="w-4 h-4" aria-hidden="true" />
              Release results
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-700 dark:text-slate-200">
          <span className="font-semibold text-slate-900 dark:text-white">{examTitle}</span>
        </p>

        {/* Grading progress, so the decision is made against real numbers. */}
        <dl className="grid grid-cols-3 gap-px rounded-card overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-200 dark:bg-slate-800">
          {[
            { label: 'Submissions', value: readiness.totalSubmissions },
            { label: 'Graded', value: readiness.graded },
            { label: 'Awaiting grading', value: readiness.ungraded },
          ].map((s) => (
            <div key={s.label} className="bg-white dark:bg-slate-900 px-3 py-2.5">
              <dd className="text-lg font-bold tabular text-slate-900 dark:text-white">{s.value}</dd>
              <dt className="text-[11px] text-slate-500 dark:text-slate-400">{s.label}</dt>
            </div>
          ))}
        </dl>

        {blocked ? (
          <Alert tone="warning" title="Grading is not complete">
            {reason}
          </Alert>
        ) : (
          <>
            <Alert tone="warning" title="Releasing cannot be undone here.">
              You can no longer treat these marks as private after release.
            </Alert>
            <div className="rounded-card border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
                Releasing results will
              </h4>
              <ul className="space-y-1.5">
                {RELEASE_EFFECTS.map((e) => (
                  <li key={e} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                    <span>{e}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};
