'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  X,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Layers,
  Users,
  Save,
  Loader2,
  AlertTriangle,
  EyeOff,
} from 'lucide-react';

// Faculty authoring for an exam's question sets, plus the student-to-set mapping.
//
// Everything in this component is faculty-facing by definition. The student side never
// receives a set label or count — see toStudentPaper() in src/lib/questionSets.ts.

interface QuestionDraft {
  order: number;
  text: string;
  marks: string;
}

interface SetDraft {
  id: string;
  label: string;
  isActive: boolean;
  assignedCount: number;
  questions: QuestionDraft[];
  dirty: boolean;
  saving: boolean;
}

interface Assignment {
  studentName: string;
  rollNumber: string | null;
  setLabel: string | null;
  startedAt: string | null;
  isSubmitted: boolean;
}

interface Props {
  labId: string;
  labTitle: string;
  token: string;
  onClose: () => void;
  onChanged?: () => void;
}

export const QuestionSetManager: React.FC<Props> = ({ labId, labTitle, token, onClose, onChanged }) => {
  const [sets, setSets] = useState<SetDraft[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'sets' | 'mapping'>('sets');

  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/lecturer/question-sets?labId=${labId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to load question sets');
        return;
      }
      setSets(
        (data.sets || []).map((s: any) => ({
          id: s.id,
          label: s.label,
          isActive: s.isActive,
          assignedCount: s.assignedCount || 0,
          questions: (s.questions || []).map((q: any) => ({
            order: q.order,
            text: q.text,
            marks: q.marks === null || q.marks === undefined ? '' : String(q.marks),
          })),
          dirty: false,
          saving: false,
        }))
      );
      setAssignments(data.assignments || []);
    } catch (e) {
      setError('Server error loading question sets');
    } finally {
      setLoading(false);
    }
  }, [labId, token]);

  useEffect(() => {
    load();
  }, [load]);

  const patchSet = (id: string, patch: Partial<SetDraft>) =>
    setSets((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch, dirty: true } : s)));

  const patchQuestions = (id: string, questions: QuestionDraft[]) =>
    patchSet(id, { questions: questions.map((q, i) => ({ ...q, order: i + 1 })) });

  const addSet = async () => {
    setError(null);
    const res = await fetch('/api/lecturer/question-sets', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ labId, questions: [] }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Failed to create set');
      return;
    }
    await load();
    onChanged?.();
  };

  const saveSet = async (set: SetDraft) => {
    setError(null);
    setSets((prev) => prev.map((s) => (s.id === set.id ? { ...s, saving: true } : s)));
    const res = await fetch('/api/lecturer/question-sets', {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        id: set.id,
        label: set.label,
        isActive: set.isActive,
        questions: set.questions.map((q) => ({ order: q.order, text: q.text, marks: q.marks })),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Failed to save set');
      setSets((prev) => prev.map((s) => (s.id === set.id ? { ...s, saving: false } : s)));
      return;
    }
    await load();
    onChanged?.();
  };

  const deleteSet = async (set: SetDraft) => {
    setError(null);
    if (!confirm(`Delete "${set.label}" and its ${set.questions.length} question(s)?`)) return;
    const res = await fetch(`/api/lecturer/question-sets?id=${set.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // The server refuses to delete a set students are already sitting; it tells the
      // lecturer to deactivate instead, and that message is worth showing verbatim.
      setError(data.error || 'Failed to delete set');
      return;
    }
    await load();
    onChanged?.();
  };

  const assignable = sets.filter((s) => s.isActive && s.questions.length > 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex flex-col p-4 sm:p-6">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl flex-1 flex flex-col overflow-hidden shadow-2xl max-w-5xl w-full mx-auto">
        {/* Header */}
        <div className="bg-slate-950 border-b border-slate-800 px-5 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Layers className="w-4 h-4 text-brand-blue-400 flex-shrink-0" />
            <h3 className="font-bold text-white text-sm truncate">Question Sets — {labTitle}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="bg-slate-950/60 border-b border-slate-800 px-5 py-2 flex items-center gap-2">
          <button
            onClick={() => setTab('sets')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
              tab === 'sets' ? 'bg-brand-blue-600 border-brand-blue-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            Sets ({sets.length})
          </button>
          <button
            onClick={() => setTab('mapping')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors flex items-center gap-1.5 ${
              tab === 'mapping' ? 'bg-brand-blue-600 border-brand-blue-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Student Assignment ({assignments.length})
          </button>
        </div>

        {error && (
          <div className="mx-5 mt-3 flex items-start gap-2 rounded-xl border border-rose-800/60 bg-rose-950/40 px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-rose-200 leading-relaxed">{error}</p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400 text-xs gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading question sets…
            </div>
          ) : tab === 'sets' ? (
            <>
              {/* How assignment currently behaves, stated plainly. */}
              <div className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 space-y-1.5">
                <div className="flex items-center gap-2 text-[11px] text-slate-300 font-semibold">
                  <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                  Students never see which set they were given, or how many sets exist.
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  {assignable.length === 0
                    ? 'No set is assignable yet, so every student receives the exam’s own problem statement. A set becomes assignable once it is active and has at least one question.'
                    : `${assignable.length} set${assignable.length === 1 ? '' : 's'} in rotation. Each student is given one at random when they start, spread evenly across sets, and it stays fixed for their whole attempt.`}
                </p>
              </div>

              {sets.map((set) => (
                <div key={set.id} className="rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2 flex-wrap">
                    <input
                      type="text"
                      value={set.label}
                      onChange={(e) => patchSet(set.id, { label: e.target.value })}
                      aria-label="Set label"
                      className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-bold text-white w-40"
                    />
                    <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
                      <input
                        type="checkbox"
                        checked={set.isActive}
                        onChange={(e) => patchSet(set.id, { isActive: e.target.checked })}
                      />
                      Active
                    </label>

                    <span className="text-[10px] font-mono text-slate-500">
                      {set.questions.length} question{set.questions.length === 1 ? '' : 's'} · assigned to{' '}
                      {set.assignedCount} student{set.assignedCount === 1 ? '' : 's'}
                    </span>

                    {set.isActive && set.questions.length === 0 && (
                      <span className="text-[10px] font-bold text-amber-300 bg-amber-950/40 border border-amber-800/60 rounded px-1.5 py-0.5">
                        not assignable — no questions
                      </span>
                    )}

                    <div className="ml-auto flex items-center gap-2">
                      <button
                        onClick={() => saveSet(set)}
                        disabled={!set.dirty || set.saving}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-olive-700 hover:bg-brand-olive-600 disabled:opacity-40 text-white text-[11px] font-bold"
                      >
                        {set.saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                        {set.dirty ? 'Save' : 'Saved'}
                      </button>
                      <button
                        onClick={() => deleteSet(set)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-900"
                        aria-label={`Delete ${set.label}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="p-4 space-y-2">
                    {set.questions.length === 0 && (
                      <p className="text-[11px] text-slate-500 italic">No questions yet. Add as many as this set needs.</p>
                    )}

                    {set.questions.map((q, qi) => (
                      <div key={qi} className="flex items-start gap-2">
                        <span className="text-[11px] font-mono text-slate-500 pt-2 w-5 text-right flex-shrink-0">{qi + 1}.</span>
                        <textarea
                          value={q.text}
                          onChange={(e) => {
                            const next = set.questions.slice();
                            next[qi] = { ...q, text: e.target.value };
                            patchQuestions(set.id, next);
                          }}
                          rows={2}
                          placeholder="Write the question…"
                          aria-label={`${set.label} question ${qi + 1}`}
                          className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-brand-blue-600 resize-y"
                        />
                        <input
                          type="number"
                          min={0}
                          step="0.5"
                          value={q.marks}
                          placeholder="Marks"
                          aria-label={`${set.label} question ${qi + 1} marks`}
                          onChange={(e) => {
                            const next = set.questions.slice();
                            next[qi] = { ...q, marks: e.target.value };
                            patchQuestions(set.id, next);
                          }}
                          className="w-16 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white flex-shrink-0"
                        />
                        <div className="flex flex-col flex-shrink-0">
                          <button
                            onClick={() => {
                              if (qi === 0) return;
                              const next = set.questions.slice();
                              [next[qi - 1], next[qi]] = [next[qi], next[qi - 1]];
                              patchQuestions(set.id, next);
                            }}
                            disabled={qi === 0}
                            aria-label={`Move question ${qi + 1} up`}
                            className="p-0.5 text-slate-500 hover:text-white disabled:opacity-30"
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => {
                              if (qi === set.questions.length - 1) return;
                              const next = set.questions.slice();
                              [next[qi], next[qi + 1]] = [next[qi + 1], next[qi]];
                              patchQuestions(set.id, next);
                            }}
                            disabled={qi === set.questions.length - 1}
                            aria-label={`Move question ${qi + 1} down`}
                            className="p-0.5 text-slate-500 hover:text-white disabled:opacity-30"
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                        </div>
                        <button
                          onClick={() => patchQuestions(set.id, set.questions.filter((_, i) => i !== qi))}
                          aria-label={`Delete question ${qi + 1}`}
                          className="p-1 text-slate-500 hover:text-rose-400 flex-shrink-0"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}

                    <button
                      onClick={() => patchQuestions(set.id, [...set.questions, { order: set.questions.length + 1, text: '', marks: '' }])}
                      className="flex items-center gap-1.5 text-[11px] font-bold text-brand-blue-400 hover:text-brand-blue-300 pt-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add question
                    </button>
                  </div>
                </div>
              ))}

              <button
                onClick={addSet}
                className="w-full py-3 rounded-2xl border-2 border-dashed border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 text-xs font-bold flex items-center justify-center gap-2 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add a question set
              </button>
            </>
          ) : (
            <div className="rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800">
                <h4 className="text-xs font-bold text-white">Student → Set Mapping</h4>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Visible to faculty only, for evaluation and for investigating irregularities.
                </p>
              </div>
              {assignments.length === 0 ? (
                <p className="p-8 text-center text-slate-500 text-xs">No student has been assigned a set yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-900/60 text-slate-400 font-semibold border-b border-slate-800">
                      <tr>
                        <th className="p-3">Roll Number</th>
                        <th className="p-3">Student</th>
                        <th className="p-3">Assigned Set</th>
                        <th className="p-3">Started</th>
                        <th className="p-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {assignments.map((a, i) => (
                        <tr key={i} className="hover:bg-slate-900/40">
                          <td className="p-3 font-mono font-bold text-white">{a.rollNumber || '—'}</td>
                          <td className="p-3 text-slate-300">{a.studentName}</td>
                          <td className="p-3">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-950/40 text-indigo-300 border border-indigo-800/50">
                              {a.setLabel || '—'}
                            </span>
                          </td>
                          <td className="p-3 text-slate-500 font-mono">
                            {a.startedAt ? new Date(a.startedAt).toLocaleString() : '—'}
                          </td>
                          <td className="p-3">
                            <span className={a.isSubmitted ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold'}>
                              {a.isSubmitted ? 'Submitted' : 'In progress'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-slate-800 px-5 py-3 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
