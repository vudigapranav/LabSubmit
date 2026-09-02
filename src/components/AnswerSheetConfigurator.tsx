'use client';

import React, { useState } from 'react';
import { ArrowUp, ArrowDown, GripVertical, Eye, X, AlertTriangle } from 'lucide-react';
import { SECTION_CATALOGUE, SectionContentSource, templateForKey } from '@/lib/answerSheet';
import { AnswerSheet, AnswerSheetSection } from './AnswerSheet';
import { Button, Modal } from '@/components/ui';

// Where the lecturer customises the ONE answer sheet for an examination: which sections
// appear, in what order, under what heading, which are mandatory, and what each is worth.
// It is a format editor, not a choice between formats.

export interface SectionDraft {
  key: string;
  label: string;
  order: number;
  enabled: boolean;
  required: boolean;
  maxMarks: string; // kept as a string while typing; normalised server-side
  contentSource: SectionContentSource;
}

export function buildDefaultDrafts(): SectionDraft[] {
  return SECTION_CATALOGUE.map((s) => ({
    key: s.key,
    label: s.label,
    order: s.order,
    enabled: s.enabled,
    required: s.required,
    maxMarks: s.maxMarks === null ? '' : String(s.maxMarks),
    contentSource: s.contentSource,
  }));
}

/**
 * Hydrates the editor from an exam's saved format. Any catalogue section the exam has no
 * row for is appended switched off, so a format saved before a section existed can still
 * be extended with it rather than the section being permanently unavailable.
 */
export function draftsFromSections(saved: any[] | undefined | null): SectionDraft[] {
  if (!saved || saved.length === 0) return buildDefaultDrafts();

  const drafts: SectionDraft[] = saved
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      key: s.key,
      label: s.label,
      order: s.order,
      enabled: s.enabled,
      required: s.required,
      maxMarks: s.maxMarks === null || s.maxMarks === undefined ? '' : String(s.maxMarks),
      contentSource: (templateForKey(s.key)?.contentSource || 'TEXT') as SectionContentSource,
    }));

  const present = new Set(drafts.map((d) => d.key));
  SECTION_CATALOGUE.filter((s) => !present.has(s.key)).forEach((s, i) => {
    drafts.push({
      key: s.key,
      label: s.label,
      order: drafts.length + i + 1,
      enabled: false,
      required: false,
      maxMarks: '',
      contentSource: s.contentSource,
    });
  });

  return drafts;
}

/**
 * Turns the working draft into exactly the payload the student answer sheet consumes, so
 * the preview renders through the real component rather than a lookalike. Ids are
 * synthetic — a preview never touches the database.
 */
export function draftsToPreviewSections(drafts: SectionDraft[]): AnswerSheetSection[] {
  return drafts
    .filter((d) => d.enabled)
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((d, i) => ({
      id: `preview-${d.key}`,
      key: d.key,
      label: d.label,
      order: i + 1,
      required: d.required,
      maxMarks: d.maxMarks.trim() === '' ? null : parseFloat(d.maxMarks),
      contentSource: d.contentSource,
    }));
}

interface Props {
  drafts: SectionDraft[];
  onChange: (drafts: SectionDraft[]) => void;
  /**
   * How many students have already begun this exam. Reconfiguring a format underneath a
   * live attempt is legal but consequential, so the lecturer is warned rather than blocked.
   */
  startedAttempts?: number;
}

export const AnswerSheetConfigurator: React.FC<Props> = ({ drafts, onChange, startedAttempts = 0 }) => {
  const [showPreview, setShowPreview] = useState(false);
  const update = (key: string, patch: Partial<SectionDraft>) => {
    onChange(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= drafts.length) return;
    const next = drafts.slice();
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next.map((d, i) => ({ ...d, order: i + 1 })));
  };

  const enabledCount = drafts.filter((d) => d.enabled).length;
  const totalMarks = drafts
    .filter((d) => d.enabled && d.maxMarks.trim() !== '')
    .reduce((sum, d) => sum + (parseFloat(d.maxMarks) || 0), 0);

  return (
    <div className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <label className="text-xs font-semibold text-slate-900 dark:text-white block">Answer Sheet Format</label>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-slate-500">
            {enabledCount} section{enabledCount === 1 ? '' : 's'} enabled
            {totalMarks > 0 && ` · ${totalMarks} marks allocated`}
          </span>
          <button
            type="button"
            onClick={() => setShowPreview(true)}
            disabled={enabledCount === 0}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-600 text-[11px] font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
          >
            <Eye className="w-3.5 h-3.5" />
            Preview
          </button>
        </div>
      </div>
      <p className="text-[10px] text-slate-500 dark:text-slate-400">
        The student&apos;s digital lab record. Switch sections on or off, rename their headings, set the order, and
        mark which must be filled in before a student can submit.
      </p>

      {startedAttempts > 0 && (
        <div className="flex items-start gap-2 rounded-control border border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/40 px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-[10px] text-amber-800 dark:text-amber-200/90 leading-relaxed">
            {startedAttempts} student{startedAttempts === 1 ? ' has' : 's have'} already started this exam. Answers
            already written are kept, but newly required sections will apply to them too — a student who has not filled
            one in will be asked to complete it before submitting.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        {drafts.map((draft, index) => (
          <div
            key={draft.key}
            className={`rounded-control border px-2.5 py-2 transition-colors ${
              draft.enabled
                ? 'bg-slate-50 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700'
                : 'bg-slate-50/40 dark:bg-slate-900/40 border-slate-200/60 dark:border-slate-800/60'
            }`}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <GripVertical className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />

              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) =>
                  update(draft.key, { enabled: e.target.checked, required: e.target.checked && draft.required })
                }
                aria-label={`Enable ${draft.label}`}
              />

              <input
                type="text"
                value={draft.label}
                onChange={(e) => update(draft.key, { label: e.target.value })}
                disabled={!draft.enabled}
                maxLength={80}
                className="flex-1 min-w-[8rem] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-900 dark:text-white disabled:opacity-50"
              />

              <span className="text-[9px] font-mono uppercase tracking-wide text-slate-400 w-16 text-center">
                {draft.key}
              </span>

              <label
                className={`flex items-center gap-1 text-[10px] font-semibold ${
                  draft.enabled ? 'text-slate-600 dark:text-slate-300' : 'text-slate-400'
                }`}
              >
                <input
                  type="checkbox"
                  checked={draft.required}
                  disabled={!draft.enabled}
                  onChange={(e) => update(draft.key, { required: e.target.checked })}
                />
                <span>Required</span>
              </label>

              <input
                type="number"
                min={0}
                step="0.5"
                placeholder="Marks"
                value={draft.maxMarks}
                disabled={!draft.enabled}
                onChange={(e) => update(draft.key, { maxMarks: e.target.value })}
                aria-label={`${draft.label} marks`}
                className="w-16 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-900 dark:text-white disabled:opacity-50"
              />

              <div className="flex items-center">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${draft.label} up`}
                  className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30"
                >
                  <ArrowUp className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === drafts.length - 1}
                  aria-label={`Move ${draft.label} down`}
                  className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30"
                >
                  <ArrowDown className="w-3 h-3" />
                </button>
              </div>
            </div>

            {draft.enabled && draft.contentSource !== 'TEXT' && (
              <p className="text-[10px] text-slate-500 dark:text-slate-400 pl-6 pt-1">
                {draft.contentSource === 'CODE_FILES'
                  ? 'Filled from the student’s source files in the editor — not typed into the sheet.'
                  : 'The input given to and output produced by the student’s program.'}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Preview. Renders the REAL student component with persistence switched off, so what
          the lecturer sees here cannot drift from what students actually get. Reflects the
          unsaved working draft, which is the point: preview before publishing. */}
      {showPreview && (
        <Modal
          open={showPreview}
          onClose={() => setShowPreview(false)}
          title="Student answer sheet preview"
          description={`Unsaved draft · ${enabledCount} section${enabledCount === 1 ? '' : 's'}`}
          size="lg"
          elevated
          footer={
            <Button variant="primary" size="sm" onClick={() => setShowPreview(false)}>
              Back to configuration
            </Button>
          }
        >
            <div className="min-h-0">
              <AnswerSheet
                preview
                labId="preview"
                token=""
                sections={draftsToPreviewSections(drafts)}
                initialResponses={[]}
                readOnly={false}
                codeFilenames={['Main.java']}
              />
            </div>

        </Modal>
      )}
    </div>
  );
};
