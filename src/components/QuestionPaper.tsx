'use client';

import React from 'react';

// Renders a paper — the questions on one student's examination.
//
// Shared by the student's problem-statement view and the lecturer's per-set preview, so a
// preview shows the paper exactly as a student will read it. A separate preview renderer
// would drift the first time either side changed.
//
// This component receives questions only. It has no concept of a set, so it cannot leak one.

export interface PaperQuestion {
  order: number;
  text: string;
  marks: number | null;
}

interface Props {
  questions: PaperQuestion[];
  /** Shown when the exam has no question sets and uses its own single statement. */
  fallbackStatement?: string;
}

export const QuestionPaper: React.FC<Props> = ({ questions, fallbackStatement }) => {
  if (!questions || questions.length === 0) {
    return <div className="font-mono whitespace-pre-wrap">{fallbackStatement}</div>;
  }

  const total = questions.reduce((sum, q) => sum + (q.marks || 0), 0);

  return (
    <div className="space-y-4">
      <ol className="space-y-4">
        {questions.map((q) => (
          <li key={q.order} className="flex gap-3">
            <span className="font-mono font-bold text-brand-olive-400 flex-shrink-0">{q.order}.</span>
            <div className="min-w-0 space-y-1">
              <p className="whitespace-pre-wrap">{q.text}</p>
              {q.marks !== null && (
                <span className="inline-block text-[10px] font-semibold text-slate-400 bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5">
                  {q.marks} marks
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>

      {total > 0 && (
        <p className="text-[11px] text-slate-500 border-t border-slate-800 pt-2 font-mono">
          {questions.length} question{questions.length === 1 ? '' : 's'} · {total} marks total
        </p>
      )}
    </div>
  );
};
