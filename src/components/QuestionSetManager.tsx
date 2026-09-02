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
  Eye,
  Shuffle,
  History,
} from 'lucide-react';
import { QuestionPaper } from './QuestionPaper';

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
  studentId: string;
  studentName: string;
  rollNumber: string | null;
  questionSetId: string | null;
  setLabel: string | null;
  startedAt: string | null;
  isSubmitted: boolean;
}

interface AdminAction {
  action: string;
  details: string;
  actorName: string;
  createdAt: string;
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
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<'sets' | 'mapping'>('sets');
  const [previewSet, setPreviewSet] = useState<SetDraft | null>(null);
  const [generating, setGenerating] = useState(false);
  const [coverage, setCoverage] = useState<{ eligibleCount: number; assignedCount: number; assignableSetCount: number } | null>(null);
  const [adminActions, setAdminActions] = useState<AdminAction[]>([]);

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

      const cov = await fetch(`/api/lecturer/assignments?labId=${labId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (cov.ok) {
        const c = await cov.json();
        setCoverage({ eligibleCount: c.eligibleCount, assignedCount: c.assignedCount, assignableSetCount: c.assignableSetCount });
        setAdminActions(c.adminActions || []);
      }
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

  const saveSet = async (set: SetDraft, acknowledgeLiveEdit = false) => {
    setError(null);
    setNotice(null);
    setSets((prev) => prev.map((s) => (s.id === set.id ? { ...s, saving: true } : s)));
    const res = await fetch('/api/lecturer/question-sets', {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        id: set.id,
        label: set.label,
        isActive: set.isActive,
        questions: set.questions.map((q) => ({ order: q.order, text: q.text, marks: q.marks })),
        ...(acknowledgeLiveEdit ? { acknowledgeLiveEdit: true } : {}),
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      setSets((prev) => prev.map((s) => (s.id === set.id ? { ...s, saving: false } : s)));
      // The server refuses to rewrite a paper students are sitting unless the lecturer says
      // so deliberately. Surface its exact wording, then ask once.
      if (data.requiresAcknowledgement) {
        if (confirm(`${data.error}\n\nChange the live paper anyway? This is recorded against your name.`)) {
          await saveSet(set, true);
        }
        return;
      }
      setError(data.error || 'Failed to save set');
      return;
    }
    await load();
    onChanged?.();
  };

  const generateAssignments = async () => {
    setError(null);
    setNotice(null);
    if (
      !confirm(
        'Assign a question set to every eligible student who does not already have one?\n\nStudents who already hold a set keep it — nothing is re-drawn.'
      )
    )
      return;
    setGenerating(true);
    try {
      const res = await fetch('/api/lecturer/assignments', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ labId, action: 'generate' }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || 'Failed to generate assignments');
      else setNotice(data.message);
      await load();
      onChanged?.();
    } finally {
      setGenerating(false);
    }
  };

  const reassign = async (a: Assignment, questionSetId: string) => {
    setError(null);
    setNotice(null);
    const target = sets.find((s) => s.id === questionSetId);
    const live = Boolean(a.startedAt) && !a.isSubmitted;
    if (
      !confirm(
        `Reassign ${a.rollNumber || a.studentName} to ${target?.label}?` +
          (live ? '\n\nTheir attempt is already in progress — their questions will change in front of them.' : '') +
          '\n\nThis is recorded against your name.'
      )
    )
      return;

    const res = await fetch('/api/lecturer/assignments', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ labId, action: 'reassign', studentId: a.studentId, questionSetId }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error || 'Failed to reassign');
    else setNotice(data.message);
    await load();
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
    <div className="fixed inset-0 z-50 bg-slate-900/60 dark:bg-slate-900/60 dark:bg-black/70 backdrop-blur-sm flex flex-col p-2 sm:p-6">
      <div className="relative bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-slate-800 rounded-card flex-1 flex flex-col overflow-hidden shadow-overlay max-w-5xl w-full mx-auto">
        {/* Header */}
        <div className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 px-5 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Layers className="w-4 h-4 text-brand-blue-400 flex-shrink-0" />
            <h3 className="font-bold text-slate-900 dark:text-white text-sm truncate">Question Sets — {labTitle}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-control text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="bg-slate-50/60 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 px-5 py-2 flex items-center gap-2">
          <button
            onClick={() => setTab('sets')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
              tab === 'sets' ? 'bg-brand-blue-600 border-brand-blue-500 text-white' : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Sets ({sets.length})
          </button>
          <button
            onClick={() => setTab('mapping')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors flex items-center gap-1.5 ${
              tab === 'mapping' ? 'bg-brand-blue-600 border-brand-blue-500 text-white' : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Student Assignment ({assignments.length})
          </button>
        </div>

        {error && (
          <div className="mx-5 mt-3 flex items-start gap-2 rounded-card border border-rose-200 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-950/40 px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-rose-700 dark:text-rose-200 leading-relaxed">{error}</p>
          </div>
        )}

        {notice && (
          <div className="mx-5 mt-3 rounded-card border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2">
            <p className="text-[11px] text-emerald-700 dark:text-emerald-200 leading-relaxed">{notice}</p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-500 dark:text-slate-400 text-xs gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading question sets…
            </div>
          ) : tab === 'sets' ? (
            <>
              {/* How assignment currently behaves, stated plainly. */}
              <div className="rounded-card border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-4 py-3 space-y-1.5">
                <div className="flex items-center gap-2 text-[11px] text-slate-700 dark:text-slate-300 font-semibold">
                  <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                  Students never see which set they were given, or how many sets exist.
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  {assignable.length === 0
                    ? 'No set is assignable yet, so every student receives the exam’s own problem statement. A set becomes assignable once it is active and has at least one question.'
                    : `${assignable.length} set${assignable.length === 1 ? '' : 's'} in rotation. Each student is given one at random when they start, spread evenly across sets, and it stays fixed for their whole attempt.`}
                </p>

                {coverage && (
                  <div className="flex items-center justify-between gap-3 flex-wrap pt-2 border-t border-slate-800/70">
                    <span className="text-[11px] text-slate-400 font-mono">
                      {coverage.assignedCount} of {coverage.eligibleCount} eligible student
                      {coverage.eligibleCount === 1 ? '' : 's'} assigned
                      {coverage.assignedCount < coverage.eligibleCount && ' — the rest are assigned when they start'}
                    </span>
                    <button
                      onClick={generateAssignments}
                      disabled={generating || assignable.length === 0}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-600 disabled:opacity-40 text-white text-[11px] font-bold"
                    >
                      {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Shuffle className="w-3.5 h-3.5" />}
                      Generate Assignments
                    </button>
                  </div>
                )}
              </div>

              {sets.map((set) => (
                <div key={set.id} className="rounded-card border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 flex-wrap">
                    <input
                      type="text"
                      value={set.label}
                      onChange={(e) => patchSet(set.id, { label: e.target.value })}
                      aria-label="Set label"
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-control px-2.5 py-1.5 text-xs font-bold text-slate-900 dark:text-white w-40"
                    />
                    <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={set.isActive}
                        onChange={(e) => patchSet(set.id, { isActive: e.target.checked })}
                      />
                      Active
                    </label>

                    <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
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
                        onClick={() => setPreviewSet(set)}
                        disabled={set.questions.length === 0}
                        aria-label={`Preview ${set.label}`}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 text-[11px] font-bold"
                      >
                        <Eye className="w-3 h-3" />
                        Preview
                      </button>
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
                        className="p-1.5 rounded-control text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-slate-900"
                        aria-label={`Delete ${set.label}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="p-4 space-y-2">
                    {set.questions.length === 0 && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">No questions yet. Add as many as this set needs.</p>
                    )}

                    {set.questions.map((q, qi) => (
                      <div key={qi} className="flex items-start gap-2">
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 pt-2 w-5 text-right flex-shrink-0">{qi + 1}.</span>
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
                          className="flex-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-control px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 resize-y"
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
                          className="w-16 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-control px-2 py-1.5 text-xs text-slate-900 dark:text-white flex-shrink-0"
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
                            className="p-0.5 text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white disabled:opacity-30"
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
                            className="p-0.5 text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white disabled:opacity-30"
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                        </div>
                        <button
                          onClick={() => patchQuestions(set.id, set.questions.filter((_, i) => i !== qi))}
                          aria-label={`Delete question ${qi + 1}`}
                          className="p-1 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 flex-shrink-0"
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
                className="w-full py-3 rounded-card border-2 border-dashed border-slate-300 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-400 dark:hover:border-slate-700 text-xs font-bold flex items-center justify-center gap-2 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add a question set
              </button>
            </>
          ) : (
            <div className="rounded-card border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
                <h4 className="text-xs font-bold text-slate-900 dark:text-white">Student → Set Mapping</h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Visible to faculty only, for evaluation and for investigating irregularities.
                </p>
              </div>
              {assignments.length === 0 ? (
                <p className="p-8 text-center text-slate-500 dark:text-slate-400 text-xs">No student has been assigned a set yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="p-3">Roll Number</th>
                        <th className="p-3">Student</th>
                        <th className="p-3">Assigned Set</th>
                        <th className="p-3">Started</th>
                        <th className="p-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {assignments.map((a, i) => (
                        <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                          <td className="p-3 font-mono font-bold text-white">{a.rollNumber || '—'}</td>
                          <td className="p-3 text-slate-300">{a.studentName}</td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-950/40 text-indigo-300 border border-indigo-800/50">
                                {a.setLabel || '—'}
                              </span>
                              {/* Administrative reassignment. A submitted attempt is a
                                  finished record, so its set is fixed and the control is
                                  withheld — the server refuses it too. */}
                              {!a.isSubmitted && (
                                <select
                                  value=""
                                  aria-label={`Reassign ${a.rollNumber || a.studentName}`}
                                  onChange={(e) => { if (e.target.value) reassign(a, e.target.value); e.target.value = ''; }}
                                  className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                                >
                                  <option value="">Reassign…</option>
                                  {sets
                                    .filter((st) => st.id !== a.questionSetId && st.questions.length > 0)
                                    .map((st) => (
                                      <option key={st.id} value={st.id}>{st.label}</option>
                                    ))}
                                </select>
                              )}
                            </div>
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

          {tab === 'mapping' && adminActions.length > 0 && (
            <div className="rounded-card border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
                <History className="w-3.5 h-3.5 text-slate-400" />
                <h4 className="text-xs font-bold text-slate-900 dark:text-white">Administrative Actions</h4>
              </div>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {adminActions.map((a, i) => (
                  <li key={i} className="px-4 py-2.5 flex items-start gap-3">
                    <span className="text-[9px] font-mono font-bold text-indigo-300 bg-indigo-950/40 border border-indigo-800/50 rounded px-1.5 py-0.5 flex-shrink-0 mt-0.5">
                      {a.action.replace(/_/g, ' ')}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11px] text-slate-700 dark:text-slate-300">{a.details}</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                        {a.actorName} · {new Date(a.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Per-set preview: the paper exactly as a student will read it, rendered through
            the same component the student's exam uses. */}
        {previewSet && (
          <div className="absolute inset-0 z-10 bg-slate-900/60 dark:bg-black/70 backdrop-blur-sm flex flex-col p-6" onClick={() => setPreviewSet(null)}>
            <div className="bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-slate-800 rounded-card flex-1 flex flex-col overflow-hidden shadow-overlay max-w-2xl w-full mx-auto" onClick={(e) => e.stopPropagation()}>
              <div className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-brand-blue-400" />
                  <h4 className="font-bold text-slate-900 dark:text-white text-sm">Preview — {previewSet.label}</h4>
                  <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 hidden sm:inline">as the student sees it</span>
                </div>
                <button onClick={() => setPreviewSet(null)} className="p-1.5 rounded-control text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close preview">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-5">
                <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-card p-4 text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
                  <QuestionPaper
                    questions={previewSet.questions.map((q, i) => ({
                      order: i + 1,
                      text: q.text || '(empty question — it will not be shown to students)',
                      marks: q.marks.trim() === '' ? null : parseFloat(q.marks),
                    }))}
                  />
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-3">
                  The student sees these questions and nothing else — no set name, no set number, and no indication that
                  other sets exist.
                </p>
              </div>
              <div className="border-t border-slate-200 dark:border-slate-800 px-5 py-3 flex justify-end">
                <button onClick={() => setPreviewSet(null)} className="px-4 py-2 rounded-control bg-brand-olive-700 hover:bg-brand-olive-600 text-white text-xs font-bold">
                  Back to sets
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="border-t border-slate-200 dark:border-slate-800 px-5 py-3 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-control bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-900 dark:text-white text-xs font-bold">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
