'use client';

import React from 'react';
import { Alert, Button, Modal } from '@/components/ui';
import { Archive, ArchiveRestore, Trash2, ShieldCheck } from 'lucide-react';
import {
  ARCHIVE_EFFECTS,
  ARCHIVE_PRESERVES,
  ExamActivity,
  NO_ACTIVITY,
  describeActivity,
  hasStudentActivity,
} from '@/lib/examLifecycle';

/**
 * The one dialog for retiring an examination. It replaces a native confirm() that said
 * "Are you sure you want to delete this exam?" over an endpoint that would cascade away
 * every submission, mark and integrity event under it.
 *
 * Which of the three faces it shows is decided by what the server reported about the exam,
 * never by the lecturer's intent:
 *
 *   - student work exists      -> deletion is refused outright and archive is offered
 *   - no student work          -> permanent deletion is confirmed, naming the exam
 *   - already archived         -> restore is offered
 *
 * The server re-derives the same rule on every DELETE, so this component choosing wrongly
 * (stale counts, a tampered payload) cannot cause student work to be destroyed — the
 * request simply comes back 409.
 */

export type RetirementIntent = 'DELETE' | 'ARCHIVE' | 'RESTORE';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Title of the exam being retired — always named, never "this exam". */
  examTitle: string;
  /** Counts from the lecturer labs payload. Absent counts are treated as "none". */
  activity?: ExamActivity | null;
  /** Whether the exam is currently archived. */
  archived: boolean;
  busy?: boolean;
  /**
   * Server refusal text, shown when a delete was attempted anyway and came back 409. Its
   * presence is what proves the guard is server-side and not merely a UI branch.
   */
  serverRefusal?: string | null;
  onConfirm: (intent: RetirementIntent) => void;
}

function PreservationList({ items, tone }: { items: string[]; tone: 'keep' | 'change' }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
          <span
            aria-hidden="true"
            className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${
              tone === 'keep' ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export const ExamRetirementDialog: React.FC<Props> = ({
  open,
  onClose,
  examTitle,
  activity,
  archived,
  busy = false,
  serverRefusal,
  onConfirm,
}) => {
  const counts = activity ?? NO_ACTIVITY;
  const hasWork = hasStudentActivity(counts) || Boolean(serverRefusal);

  const intent: RetirementIntent = archived ? 'RESTORE' : hasWork ? 'ARCHIVE' : 'DELETE';

  const title =
    intent === 'RESTORE'
      ? 'Restore examination'
      : intent === 'ARCHIVE'
        ? 'Archive examination'
        : 'Delete examination';

  const description =
    intent === 'RESTORE'
      ? 'Return this examination to the active workflow.'
      : intent === 'ARCHIVE'
        ? 'This examination holds student work, so it cannot be deleted.'
        : 'This examination has no student work and can be permanently deleted.';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="md"
      /* A destructive decision must not be resolved by a stray click beside the dialog. */
      dismissOnBackdrop={false}
      footer={
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {intent === 'DELETE' && (
            <Button variant="danger" loading={busy} onClick={() => onConfirm('DELETE')}>
              <Trash2 className="w-4 h-4" aria-hidden="true" />
              Delete permanently
            </Button>
          )}
          {intent === 'ARCHIVE' && (
            <Button variant="primary" loading={busy} onClick={() => onConfirm('ARCHIVE')}>
              <Archive className="w-4 h-4" aria-hidden="true" />
              Archive exam
            </Button>
          )}
          {intent === 'RESTORE' && (
            <Button variant="primary" loading={busy} onClick={() => onConfirm('RESTORE')}>
              <ArchiveRestore className="w-4 h-4" aria-hidden="true" />
              Restore exam
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-700 dark:text-slate-200">
          <span className="font-semibold text-slate-900 dark:text-white">{examTitle}</span>
        </p>

        {intent === 'ARCHIVE' && (
          <>
            <Alert tone="danger" title="Exam cannot be deleted because student attempts exist.">
              {serverRefusal ? (
                <span>{serverRefusal}</span>
              ) : (
                <span>
                  This examination holds {describeActivity(counts)}. Deleting it would destroy that
                  work permanently, so the server refuses the deletion.
                </span>
              )}
            </Alert>

            <div className="rounded-card border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                Archiving preserves
              </h4>
              <PreservationList items={ARCHIVE_PRESERVES} tone="keep" />
            </div>

            <div className="rounded-card border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                Archiving changes
              </h4>
              <PreservationList items={ARCHIVE_EFFECTS} tone="change" />
            </div>
          </>
        )}

        {intent === 'DELETE' && (
          <Alert tone="danger" title="This cannot be undone.">
            No student has started an attempt, submitted work, written a file or triggered an
            integrity event for this examination, so nothing of a student&rsquo;s is lost. Its
            question sets and answer-sheet configuration are deleted with it.
          </Alert>
        )}

        {intent === 'RESTORE' && (
          <Alert tone="info" title="The examination returns to the active workflow.">
            Students in the matching year and branch will see it again according to its schedule.
            Check its dates before restoring if the exam window has already passed.
          </Alert>
        )}
      </div>
    </Modal>
  );
};
