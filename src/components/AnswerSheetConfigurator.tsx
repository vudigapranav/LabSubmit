'use client';

import React from 'react';
import { ArrowUp, ArrowDown, GripVertical } from 'lucide-react';
import { SECTION_CATALOGUE, SectionContentSource, templateForKey } from '@/lib/answerSheet';

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

interface Props {
  drafts: SectionDraft[];
  onChange: (drafts: SectionDraft[]) => void;
}

export const AnswerSheetConfigurator: React.FC<Props> = ({ drafts, onChange }) => {
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
      <div className="flex items-center justify-between flex-wrap gap-1">
        <label className="text-xs font-semibold text-slate-900 dark:text-white block">Answer Sheet Format</label>
        <span className="text-[10px] font-mono text-slate-500">
          {enabledCount} section{enabledCount === 1 ? '' : 's'} enabled
          {totalMarks > 0 && ` · ${totalMarks} marks allocated`}
        </span>
      </div>
      <p className="text-[10px] text-slate-500 dark:text-slate-400">
        The student&apos;s digital lab record. Switch sections on or off, rename their headings, set the order, and
        mark which must be filled in before a student can submit.
      </p>

      <div className="space-y-1.5">
        {drafts.map((draft, index) => (
          <div
            key={draft.key}
            className={`rounded-xl border px-2.5 py-2 transition-colors ${
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
    </div>
  );
};
