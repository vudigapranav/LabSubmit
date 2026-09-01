'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Check, Loader2, AlertCircle, Code2 } from 'lucide-react';
import { detectClientDeviceClass } from '@/lib/useDeviceClass';

// The student's digital lab record. One sheet per attempt, laid out exactly as the
// lecturer configured this exam's format — same model for every exam, only the enabled
// sections and their order differ.

export interface AnswerSheetSection {
  id: string;
  key: string;
  label: string;
  order: number;
  required: boolean;
  maxMarks: number | null;
  contentSource: 'TEXT' | 'CODE_FILES' | 'EXECUTION_IO' | string;
}

interface AnswerSheetProps {
  labId: string;
  token: string;
  sections: AnswerSheetSection[];
  initialResponses: { sectionId: string; content: string }[];
  readOnly: boolean;
  /** Filenames currently in the workspace, shown against the Code section. */
  codeFilenames: string[];
  onOpenEditor?: () => void;
}

const AUTOSAVE_DEBOUNCE_MS = 1200;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export const AnswerSheet: React.FC<AnswerSheetProps> = ({
  labId,
  token,
  sections,
  initialResponses,
  readOnly,
  codeFilenames,
  onOpenEditor,
}) => {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    initialResponses.forEach((r) => {
      seed[r.sectionId] = r.content;
    });
    return seed;
  });
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});

  // One debounce timer per section, so typing in Aim never cancels a pending save of
  // Algorithm — each field settles and persists on its own.
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const persist = useCallback(
    async (sectionId: string, content: string) => {
      setSaveState((prev) => ({ ...prev, [sectionId]: 'saving' }));
      try {
        const res = await fetch('/api/student/workspace', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'X-LabSubmit-Device-Class': detectClientDeviceClass(),
          },
          body: JSON.stringify({ action: 'save_section', labId, sectionId, content }),
        });
        setSaveState((prev) => ({ ...prev, [sectionId]: res.ok ? 'saved' : 'error' }));
      } catch (e) {
        setSaveState((prev) => ({ ...prev, [sectionId]: 'error' }));
      }
    },
    [labId, token]
  );

  const handleChange = (sectionId: string, content: string) => {
    setValues((prev) => ({ ...prev, [sectionId]: content }));
    clearTimeout(timersRef.current[sectionId]);
    timersRef.current[sectionId] = setTimeout(() => persist(sectionId, content), AUTOSAVE_DEBOUNCE_MS);
  };

  // Leaving a field commits it immediately rather than waiting out the debounce — the
  // moment a student tabs to the next section, the previous one is already safe.
  const handleBlur = (sectionId: string) => {
    if (readOnly) return;
    clearTimeout(timersRef.current[sectionId]);
    persist(sectionId, values[sectionId] || '');
  };

  if (sections.length === 0) return null;

  return (
    <div className="h-full overflow-y-auto bg-slate-950 rounded-2xl border border-slate-800 p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center space-x-2">
          <FileText className="w-4 h-4 text-brand-blue-400" />
          <h3 className="text-sm font-bold text-white">Digital Lab Record</h3>
        </div>
        <span className="text-[11px] text-slate-500 font-mono">
          {sections.length} section{sections.length === 1 ? '' : 's'}
        </span>
      </div>

      {sections.map((section, index) => {
        const state = saveState[section.id] || 'idle';
        const isCodeSection = section.contentSource === 'CODE_FILES';

        return (
          <div key={section.id} className="space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-1">
              <label htmlFor={`section-${section.id}`} className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <span className="text-slate-500 font-mono">{index + 1}.</span>
                <span>{section.label}</span>
                {section.required && <span className="text-rose-400" title="Required">*</span>}
                {section.maxMarks !== null && (
                  <span className="text-[10px] font-semibold text-slate-400 bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5">
                    {section.maxMarks} marks
                  </span>
                )}
              </label>

              {!readOnly && !isCodeSection && (
                <span className="text-[10px] font-semibold flex items-center gap-1">
                  {state === 'saving' && (
                    <span className="text-slate-400 flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> Saving
                    </span>
                  )}
                  {state === 'saved' && (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Saved
                    </span>
                  )}
                  {state === 'error' && (
                    <span className="text-rose-400 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> Not saved
                    </span>
                  )}
                </span>
              )}
            </div>

            {isCodeSection ? (
              // The Code section is not a textarea: it is the workspace itself, so a
              // student can never have code in the record that differs from what ran.
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Code2 className="w-4 h-4 text-brand-olive-400 flex-shrink-0" />
                  <span className="text-[11px] text-slate-400 truncate">
                    {codeFilenames.length > 0
                      ? `Taken from your source files: ${codeFilenames.join(', ')}`
                      : 'No source files yet — write your code in the editor.'}
                  </span>
                </div>
                {onOpenEditor && (
                  <button
                    type="button"
                    onClick={onOpenEditor}
                    className="text-[11px] font-semibold text-brand-blue-400 hover:text-brand-blue-300 whitespace-nowrap"
                  >
                    Open editor
                  </button>
                )}
              </div>
            ) : (
              <textarea
                id={`section-${section.id}`}
                value={values[section.id] || ''}
                onChange={(e) => handleChange(section.id, e.target.value)}
                onBlur={() => handleBlur(section.id)}
                readOnly={readOnly}
                rows={section.contentSource === 'EXECUTION_IO' ? 4 : 6}
                spellCheck={false}
                placeholder={readOnly ? '' : `Write your ${section.label.toLowerCase()} here...`}
                className={`w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-xs leading-relaxed text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-brand-blue-600 resize-y ${
                  section.contentSource === 'EXECUTION_IO' ? 'font-mono' : ''
                } ${readOnly ? 'opacity-80 cursor-default' : ''}`}
              />
            )}
          </div>
        );
      })}

      <p className="text-[11px] text-slate-500 border-t border-slate-800 pt-3">
        Sections marked <span className="text-rose-400">*</span> must be completed before you can submit. Your work
        saves automatically as you write.
      </p>
    </div>
  );
};
