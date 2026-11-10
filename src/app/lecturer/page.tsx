'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { AppShell, LECTURER_NAV } from '@/components/AppShell';
import {
  Button,
  Card,
  Modal,
  EmptyState,
  TableWrap,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  EXAM_STATUS_TONE,
  LoadingState,
  PageHeader,
  StatCard,
  StatusBadge,
  Toast as UiToast,
  Alert,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import { evaluateSectionMarks, gradableSections } from '@/lib/answerSheet';
import { ProfileModal } from '@/components/ProfileModal';
import { OnlineIDE } from '@/components/OnlineIDE';
import { RunHistory } from '@/components/RunHistory';
import {
  AnswerSheetConfigurator,
  SectionDraft,
  buildDefaultDrafts,
  draftsFromSections,
} from '@/components/AnswerSheetConfigurator';
import { QuestionSetManager } from '@/components/QuestionSetManager';
import { ExamRetirementDialog } from '@/components/ExamRetirementDialog';
import { ResultReleaseDialog } from '@/components/ResultReleaseDialog';
import { NO_SUBMISSIONS, RELEASE_STATE_LABEL, releaseState } from '@/lib/resultRelease';
import { deriveIntegrityStatus, type IntegrityStatus, type Severity } from '@/lib/examIntegrity';
import { validateExamSchedule, getExamWindowEnd } from '@/lib/examTiming';
import {
  GraduationCap,
  Plus,
  Edit2,
  Trash2,
  Archive,
  ArchiveRestore,
  BookOpen,
  CheckCircle,
  AlertCircle,
  ArrowLeft,
  ShieldAlert,
  Users,
  Hourglass,
  PlayCircle,
  Clock,
  FileText,
  Code,
  Layers,
  ClipboardCheck,
  Send,
  TerminalSquare,
} from 'lucide-react';

const LECTURER_VIEW_KEY = 'labsubmit.lecturer.view';

const LANGUAGE_OPTIONS = [
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'java', label: 'Java' },
  { value: 'python', label: 'Python' },
  { value: 'javascript', label: 'JavaScript' },
];

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-800 text-slate-400 border border-slate-700',
  UPCOMING: 'bg-amber-950/40 text-amber-300 border border-amber-800/50',
  RUNNING: 'bg-emerald-950/40 text-emerald-300 border border-emerald-800/50',
  COMPLETED: 'bg-slate-800 text-slate-400 border border-slate-700',
};

function toDateInputValue(iso?: string | null) {
  if (!iso) return '';
  // Use local date components (matches toTimeInputValue below) — .toISOString() converts
  // to UTC first, which silently rolls the date back a day for timezones behind UTC.
  const d = new Date(iso);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function toTimeInputValue(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function combineDateTime(dateStr: string, timeStr: string): string | null {
  if (!dateStr || !timeStr) return null;
  const d = new Date(`${dateStr}T${timeStr}:00`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export default function LecturerDashboard() {
  const router = useRouter();
  const { user, token, loading } = useApp();

  // Mode: 'assignments' (Cards grid view) vs 'workspace' (Single Subject view)
  const [viewMode, setViewMode] = useState<'assignments' | 'workspace'>('assignments');
  const [activeMainTab, setActiveMainTab] = useState<'labs' | 'students' | 'submissions' | 'violations'>('labs');
  const [profileOpen, setProfileOpen] = useState(false);

  // Selected Assignment Context
  const [selectedSubject, setSelectedSubject] = useState<any | null>(null);

  // Data states
  const [assignedSubjects, setAssignedSubjects] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [labs, setLabs] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [violations, setViolations] = useState<any[]>([]);

  // Modals & form inputs
  const [showLabModal, setShowLabModal] = useState(false);
  const [labTitle, setLabTitle] = useState('');
  const [labDesc, setLabDesc] = useState('');
  const [labProblem, setLabProblem] = useState('');
  const [editingLabId, setEditingLabId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Exam scheduling fields
  const [examDateInput, setExamDateInput] = useState('');
  const [startTimeInput, setStartTimeInput] = useState('');
  const [endTimeInput, setEndTimeInput] = useState('');
  const [durationMinutesInput, setDurationMinutesInput] = useState('');
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(['c', 'cpp', 'java', 'python']);
  const [examModeEnabled, setExamModeEnabled] = useState(true);
  const [fullscreenThresholdInput, setFullscreenThresholdInput] = useState('3');
  const [requireDesktopDevice, setRequireDesktopDevice] = useState(true);
  const [sectionDrafts, setSectionDrafts] = useState<SectionDraft[]>(buildDefaultDrafts());
  // Drives the configurator's warning when a format is edited under a live exam.
  const [editingLabAttempts, setEditingLabAttempts] = useState(0);
  const [questionSetsLab, setQuestionSetsLab] = useState<any | null>(null);

  // Result release. One dialog, server-decided outcome.
  const [releasingLab, setReleasingLab] = useState<any | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [releaseRefusal, setReleaseRefusal] = useState<string | null>(null);

  // Exam retirement (delete / archive / restore). One dialog, server-decided outcome.
  const [retiringLab, setRetiringLab] = useState<any | null>(null);
  const [retiring, setRetiring] = useState(false);
  const [retireRefusal, setRetireRefusal] = useState<string | null>(null);

  // Anti-Cheat Permissions
  const [allowCopy, setAllowCopy] = useState(false);
  const [allowPaste, setAllowPaste] = useState(false);

  // Evaluation & Submission Viewer
  const [selectedSubmission, setSelectedSubmission] = useState<any | null>(null);
  const [evalMarks, setEvalMarks] = useState('');
  const [evalRemarks, setEvalRemarks] = useState('');
  const [evalStatus, setEvalStatus] = useState('APPROVED');
  // Per-section marks for exams whose answer sheet has weighted sections, keyed by section id.
  const [evalSectionMarks, setEvalSectionMarks] = useState<Record<string, { marks: string; remarks: string }>>({});

  // Open the grading panel on what was actually saved. It used to open blank as APPROVED,
  // so re-saving an evaluated submission could silently change a decision the lecturer had
  // deliberately left otherwise.
  useEffect(() => {
    const sub = selectedSubmission;
    if (!sub) return;
    const evaluated = sub.evaluatedAt || sub.marks !== null;
    setEvalStatus(evaluated ? sub.status : 'APPROVED');
    setEvalMarks(sub.marks !== null && sub.marks !== undefined ? String(sub.marks) : '');
    setEvalRemarks(sub.remarks || '');
    const prefill: Record<string, { marks: string; remarks: string }> = {};
    (sub.answerSheet || []).forEach((sec: any) => {
      prefill[sec.id] = {
        marks: sec.evaluation?.marks !== null && sec.evaluation?.marks !== undefined ? String(sec.evaluation.marks) : '',
        remarks: sec.evaluation?.remarks || '',
      };
    });
    setEvalSectionMarks(prefill);
    // Keyed on the id: refetches must not overwrite marks being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSubmission?.id]);
  const [inspectorPane, setInspectorPane] = useState<'sheet' | 'code' | 'runs'>('sheet');

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'LECTURER')) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (token) {
      fetchAssignedSubjects();
    }
  }, [token]);

  useEffect(() => {
    if (token && selectedSubject) {
      fetchWorkspaceData();
    }
  }, [token, selectedSubject]);

  // Remember where the lecturer is, so a refresh does not drop them back to the subject list.
  // Nothing is written until the restore attempt in fetchAssignedSubjects has run; otherwise
  // the initial 'assignments' render would erase the saved view before it could be read.
  const viewRestoredRef = useRef(false);
  useEffect(() => {
    if (!viewRestoredRef.current) return;
    try {
      if (viewMode === 'workspace' && selectedSubject) {
        sessionStorage.setItem(LECTURER_VIEW_KEY, JSON.stringify({ subjectId: selectedSubject.id, tab: activeMainTab }));
      } else if (viewMode === 'assignments') {
        sessionStorage.removeItem(LECTURER_VIEW_KEY);
      }
    } catch { /* ignore */ }
  }, [viewMode, selectedSubject, activeMainTab]);

  const showToast = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  const fetchAssignedSubjects = async () => {
    try {
      const res = await fetch('/api/lecturer/sections', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const subjects = data.subjects || [];
        setAssignedSubjects(subjects);
        // Reopen the subject and tab the lecturer was on before a refresh. Only a subject that
        // is still assigned to them is restored; anything else falls back to the subject list.
        try {
          const saved = JSON.parse(sessionStorage.getItem(LECTURER_VIEW_KEY) || 'null');
          const sub = saved && subjects.find((x: any) => x.id === saved.subjectId);
          if (sub) {
            setSelectedSubject(sub);
            setViewMode('workspace');
            if (['labs', 'students', 'submissions', 'violations'].includes(saved.tab)) setActiveMainTab(saved.tab);
          }
        } catch { /* storage unavailable: start on the subject list */ }
        viewRestoredRef.current = true;
      }
    } catch (e) { console.error(e); }
  };

  const fetchWorkspaceData = async () => {
    if (!selectedSubject) return;
    try {
      // Fetch exams for selected subject
      const labsRes = await fetch(`/api/lecturer/labs?subjectId=${selectedSubject.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (labsRes.ok) {
        const data = await labsRes.json();
        setLabs(data.labs || []);
      }

      // Fetch enrolled students for selected subject's branch and year
      const studentsRes = await fetch(`/api/lecturer/students?year=${selectedSubject.year}&branchId=${selectedSubject.branchId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (studentsRes.ok) {
        const data = await studentsRes.json();
        setStudents(data.students || []);
      }

      // Fetch submissions
      const subRes = await fetch(`/api/lecturer/submissions?year=${selectedSubject.year}&branchId=${selectedSubject.branchId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (subRes.ok) {
        const data = await subRes.json();
        setSubmissions(data.submissions || []);
      }

      // Fetch violation logs
      const violRes = await fetch(`/api/lecturer/violations?year=${selectedSubject.year}&branchId=${selectedSubject.branchId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (violRes.ok) {
        const data = await violRes.json();
        setViolations(data.violations || []);
      }
    } catch (e) { console.error(e); }
  };

  const handleOpenSubjectWorkspace = (sub: any) => {
    setSelectedSubject(sub);
    setViewMode('workspace');
    setActiveMainTab('labs');
  };

  const resetLabForm = () => {
    setEditingLabId(null);
    setLabTitle('');
    setLabDesc('');
    setLabProblem('');
    setAllowCopy(false);
    setAllowPaste(false);
    setExamDateInput('');
    setStartTimeInput('');
    setEndTimeInput('');
    setDurationMinutesInput('');
    setSelectedLanguages(['c', 'cpp', 'java', 'python']);
    setExamModeEnabled(true);
    setFullscreenThresholdInput('3');
    setRequireDesktopDevice(true);
    setSectionDrafts(buildDefaultDrafts());
    setEditingLabAttempts(0);
  };

  const openCreateModal = () => {
    resetLabForm();
    setShowLabModal(true);
  };

  const openEditModal = (lab: any) => {
    setEditingLabId(lab.id);
    setLabTitle(lab.title);
    setLabDesc(lab.description || '');
    setLabProblem(lab.problemStatement);
    setAllowCopy(lab.allowCopy || false);
    setAllowPaste(lab.allowPaste || false);
    setExamDateInput(toDateInputValue(lab.examDate || lab.startTime));
    setStartTimeInput(toTimeInputValue(lab.startTime));
    setEndTimeInput(toTimeInputValue(lab.endTime));
    setDurationMinutesInput(lab.durationMinutes ? String(lab.durationMinutes) : '');
    setSelectedLanguages(
      typeof lab.allowedLanguages === 'string'
        ? lab.allowedLanguages.split(',').filter(Boolean)
        : lab.allowedLanguages || ['c', 'cpp', 'java', 'python']
    );
    setExamModeEnabled(lab.examModeEnabled !== undefined ? lab.examModeEnabled : true);
    setFullscreenThresholdInput(String(lab.fullscreenExitThreshold ?? 3));
    setRequireDesktopDevice(lab.requireDesktopDevice !== undefined ? lab.requireDesktopDevice : true);
    setSectionDrafts(draftsFromSections(lab.answerSheetSections));
    setEditingLabAttempts(lab.appearedCount || 0);
    setShowLabModal(true);
  };

  const toggleLanguage = (lang: string) => {
    setSelectedLanguages((prev) => (prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang]));
  };

  const handleSaveLab = async (e: React.FormEvent, publish: boolean) => {
    e.preventDefault();
    if (!selectedSubject) return;

    // Same rule the server enforces (examTiming.validateExamSchedule). An end time at or before
    // the start used to be saved and made the exam complete the moment it began.
    const scheduleErrors = validateExamSchedule({
      startTime: combineDateTime(examDateInput, startTimeInput),
      endTime: combineDateTime(examDateInput, endTimeInput),
      durationMinutes: durationMinutesInput,
      examModeEnabled,
    });
    if (scheduleErrors.length > 0) {
      showToast('error', scheduleErrors[0]);
      return;
    }
    if (selectedLanguages.length === 0) {
      showToast('error', 'Select at least one allowed programming language');
      return;
    }
    if (!sectionDrafts.some((d) => d.enabled)) {
      showToast('error', 'Enable at least one answer sheet section');
      return;
    }

    const endpoint = '/api/lecturer/labs';
    const method = editingLabId ? 'PUT' : 'POST';

    setSaving(true);
    try {
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          id: editingLabId,
          title: labTitle,
          description: labDesc,
          problemStatement: labProblem,
          year: selectedSubject.year,
          branchId: selectedSubject.branchId,
          subjectId: selectedSubject.id,
          allowCopy,
          allowPaste,
          examDate: combineDateTime(examDateInput, '00:00'),
          startTime: combineDateTime(examDateInput, startTimeInput),
          endTime: combineDateTime(examDateInput, endTimeInput),
          durationMinutes: durationMinutesInput ? parseInt(durationMinutesInput) : null,
          allowedLanguages: selectedLanguages,
          examModeEnabled,
          fullscreenExitThreshold: parseInt(fullscreenThresholdInput) || 3,
          requireDesktopDevice,
          isPublished: publish,
          answerSheetSections: sectionDrafts.map((d, i) => ({
            key: d.key,
            label: d.label,
            order: i + 1,
            enabled: d.enabled,
            required: d.required,
            maxMarks: d.maxMarks,
          })),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('success', editingLabId ? 'Exam updated' : publish ? 'Exam published' : 'Exam saved as draft');
        setShowLabModal(false);
        resetLabForm();
        fetchWorkspaceData();
        fetchAssignedSubjects();
      } else {
        showToast('error', data.error || 'Failed to save exam');
      }
    } catch (e) { showToast('error', 'Server error'); } finally { setSaving(false); }
  };

  // Retiring an exam goes through one dialog, and the server decides the outcome. A DELETE
  // that the server refuses (409) does not fail silently: the refusal is fed back into the
  // dialog, which switches to offering Archive with the server's own wording.
  const handleRetireExam = async (intent: 'DELETE' | 'ARCHIVE' | 'RESTORE') => {
    const lab = retiringLab;
    if (!lab) return;

    setRetiring(true);
    try {
      if (intent === 'DELETE') {
        const res = await fetch(`/api/lecturer/labs?id=${lab.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));

        if (res.status === 409) {
          // The guard fired. Keep the dialog open and show why, rather than reporting a
          // failure the lecturer cannot act on.
          setRetireRefusal(data.error || 'This exam holds student work and cannot be deleted.');
          setRetiringLab({ ...lab, activity: data.activity ?? lab.activity, canDelete: false });
          return;
        }
        if (!res.ok) {
          showToast('error', data.error || 'Failed to delete exam');
          return;
        }
        showToast('success', `"${lab.title}" deleted`);
      } else {
        const res = await fetch('/api/lecturer/labs', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id: lab.id, archived: intent === 'ARCHIVE' }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showToast('error', data.error || 'Failed to update exam');
          return;
        }
        showToast(
          'success',
          intent === 'ARCHIVE'
            ? `"${lab.title}" archived — submissions, marks and question sets kept`
            : `"${lab.title}" restored`
        );
      }

      closeRetireDialog();
      fetchWorkspaceData();
      fetchAssignedSubjects();
    } catch (e) {
      showToast('error', 'Server error');
    } finally {
      setRetiring(false);
    }
  };

  // Releasing goes through the same lifecycle endpoint as archive. A 409 (grading
  // incomplete) is fed back into the dialog rather than reported as a bare failure.
  const handleReleaseResults = async () => {
    const lab = releasingLab;
    if (!lab) return;

    setReleasing(true);
    try {
      const res = await fetch('/api/lecturer/labs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: lab.id, releaseResults: true }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 409) {
        setReleaseRefusal(data.error || 'Results cannot be released yet.');
        setReleasingLab({ ...lab, releaseReadiness: data.readiness ?? lab.releaseReadiness });
        return;
      }
      if (!res.ok) {
        showToast('error', data.error || 'Failed to release results');
        return;
      }

      showToast('success', data.message || 'Results released');
      closeReleaseDialog();
      fetchWorkspaceData();
    } catch (e) {
      showToast('error', 'Server error');
    } finally {
      setReleasing(false);
    }
  };

  const openReleaseDialog = (lab: any) => {
    setReleaseRefusal(null);
    setReleasingLab(lab);
  };

  const closeReleaseDialog = () => {
    setReleasingLab(null);
    setReleaseRefusal(null);
  };

  const openRetireDialog = (lab: any) => {
    setRetireRefusal(null);
    setRetiringLab(lab);
  };

  const closeRetireDialog = () => {
    setRetiringLab(null);
    setRetireRefusal(null);
  };

  // Weighted sections of the open submission, and the live roll-up the server will compute.
  // The inspector payload only carries enabled sections.
  const gradingSections = gradableSections(
    ((selectedSubmission?.answerSheet || []) as any[]).map((sec) => ({ ...sec, enabled: true }))
  );
  const sectionPreview = evaluateSectionMarks(
    gradingSections,
    gradingSections.map((sec) => ({ sectionId: sec.id, marks: evalSectionMarks[sec.id]?.marks ?? '', remarks: evalSectionMarks[sec.id]?.remarks ?? '' }))
  );
  // Mirrors the server: a final (non-PENDING) status needs every weighted section marked, because
  // release publishes final-status submissions and must never show a partial total.
  const finalStatusBlocked = gradingSections.length > 0 && evalStatus !== 'PENDING' && !sectionPreview.complete;

  const handleEvaluateSubmission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSubmission) return;

    try {
      const res = await fetch('/api/lecturer/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          submissionId: selectedSubmission.id,
          status: evalStatus,
          remarks: evalRemarks,
          // Weighted exams send section marks and the server computes the total; others keep
          // the single flat mark.
          ...(gradingSections.length > 0
            ? { sectionMarks: gradingSections.map((sec) => ({ sectionId: sec.id, marks: evalSectionMarks[sec.id]?.marks ?? '', remarks: evalSectionMarks[sec.id]?.remarks ?? '' })) }
            : { marks: evalMarks === '' ? null : evalMarks }),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('success', 'Submission evaluated successfully');
        setSelectedSubmission(null);
        fetchWorkspaceData();
      } else {
        showToast('error', data.error || 'Evaluation failed');
      }
    } catch (e) { showToast('error', 'Server error'); }
  };

  if (loading || !user) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white font-mono text-xs">Loading Faculty Portal...</div>;
  }

  const statusCounts = labs.reduce(
    (acc: Record<string, number>, lab) => {
      acc[lab.status] = (acc[lab.status] || 0) + 1;
      return acc;
    },
    { DRAFT: 0, UPCOMING: 0, RUNNING: 0, COMPLETED: 0 }
  );

  const submissionViolations = selectedSubmission
    ? violations.filter((v) => v.labId === selectedSubmission.labId && v.studentId === selectedSubmission.studentId)
    : [];

  const integrityStatus: IntegrityStatus | null = selectedSubmission
    ? deriveIntegrityStatus(
        submissionViolations,
        selectedSubmission.fullscreenExitCount || 0,
        selectedSubmission.fullscreenExitThreshold || 3
      )
    : null;

  // Chronological timeline: real violation events plus synthetic (display-only, not
  // persisted) "Exam Started"/"Exam Submitted" bookends from the workspace record.
  const timelineEvents = selectedSubmission
    ? [
        ...(selectedSubmission.startedAt
          ? [{ id: 'start', label: 'Exam Started', severity: 'INFO' as const, timestamp: selectedSubmission.startedAt }]
          : []),
        ...submissionViolations.map((v) => ({ id: v.id, label: v.type, severity: v.severity as Severity, timestamp: v.createdAt })),
        ...(selectedSubmission.submittedAt
          ? [{
              id: 'submit',
              label: selectedSubmission.autoSubmitted ? 'Exam Auto-Submitted' : 'Exam Submitted',
              severity: 'INFO' as const,
              timestamp: selectedSubmission.submittedAt,
            }]
          : []),
      ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    : [];

  const INTEGRITY_STATUS_STYLES: Record<IntegrityStatus, string> = {
    NORMAL: 'bg-emerald-950/40 text-emerald-300 border-emerald-800/50',
    WARNING: 'bg-amber-950/40 text-amber-300 border-amber-800/50',
    FLAGGED: 'bg-rose-950/40 text-rose-300 border-rose-800/50',
  };

  const SEVERITY_DOT_STYLES: Record<string, string> = {
    INFO: 'bg-slate-500',
    LOW: 'bg-slate-400',
    MEDIUM: 'bg-amber-400',
    HIGH: 'bg-rose-500',
    CRITICAL: 'bg-red-600',
  };

  // Sidebar sections map onto the workspace tabs this page already renders. Selecting a
  // workspace section without a subject chosen returns to the subject list, because the
  // other tabs have no meaning until a subject is open.
  const navActive = viewMode === 'assignments' ? 'assignments' : activeMainTab;
  const handleNavigate = (id: string) => {
    if (id === 'assignments') {
      setViewMode('assignments');
      return;
    }
    if (!selectedSubject) {
      // Without this the sidebar item silently did nothing. One subject: open it. Several:
      // say what is needed rather than ignoring the click.
      if (assignedSubjects.length === 1) {
        setSelectedSubject(assignedSubjects[0]);
      } else {
        setViewMode('assignments');
        showToast('error', assignedSubjects.length === 0 ? 'No subject is assigned to you yet. Ask the administrator to assign one.' : 'Open a subject first — examinations, students and evaluations are kept per subject.');
        return;
      }
    }
    setViewMode('workspace');
    setActiveMainTab(id as typeof activeMainTab);
  };

  return (
    <>
      <AppShell
        sections={LECTURER_NAV}
        active={navActive}
        onNavigate={handleNavigate}
        contextLabel={viewMode === 'workspace' && selectedSubject ? `${selectedSubject.code} · ${selectedSubject.name}` : undefined}
        onOpenProfile={() => setProfileOpen(true)}
      >
        <PageHeader
          title={viewMode === 'workspace' && selectedSubject ? selectedSubject.name : 'Faculty workspace'}
          description={
            viewMode === 'workspace' && selectedSubject
              ? 'Author examinations, manage question sets and evaluate submissions for this subject.'
              : 'Choose a subject to author examinations, manage question sets and evaluate submissions.'
          }
          meta={<><span>{user.name}</span><span>{user.email}</span></>}
          actions={
            viewMode === 'workspace' ? (
              <Button variant="outline" size="sm" onClick={() => setViewMode('assignments')}>
                <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                All subjects
              </Button>
            ) : undefined
          }
        />

        {/* View Mode 1: My Academic Assignments (Cards Grid) */}
        {viewMode === 'assignments' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">My Academic Assignments</h2>
              <span className="text-xs text-slate-500 font-mono">{assignedSubjects.length} Assigned Subject(s)</span>
            </div>

            {assignedSubjects.length === 0 ? (
              <div className="bg-white dark:bg-surface-darkCard p-8 rounded-card border border-slate-200 dark:border-slate-800 text-center space-y-2">
                <BookOpen className="w-10 h-10 text-slate-400 mx-auto" />
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">No Assigned Subjects</h3>
                <p className="text-xs text-slate-500">You are currently not assigned to teach any subjects by the Admin.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {assignedSubjects.map((sub) => (
                  <div
                    key={sub.id}
                    className="bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-slate-800/80 rounded-card p-6 shadow-card flex flex-col justify-between space-y-4 hover:border-brand-olive-600/60 transition-all"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="px-2.5 py-0.5 rounded-md text-[11px] font-mono font-bold bg-brand-olive-950/40 text-brand-olive-300 border border-brand-olive-800/50">
                          Year {sub.year} • {sub.branch?.name || 'Branch'}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">Code: {sub.code}</span>
                      </div>

                      <div>
                        <h3 className="font-bold text-base text-slate-900 dark:text-white">{sub.name}</h3>
                        <p className="text-xs text-slate-500 font-mono mt-0.5">Semester {sub.semester || 'N/A'}</p>
                      </div>
                    </div>

                    <div className="space-y-3 border-t border-slate-100 dark:border-slate-800 pt-3">
                      <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300 font-medium">
                        <span>Exams: <strong className="text-slate-900 dark:text-white font-bold">{sub._count?.labs || 0}</strong></span>
                      </div>

                      <button
                        onClick={() => handleOpenSubjectWorkspace(sub)}
                        className="w-full py-2.5 rounded-control bg-brand-olive-700 hover:bg-brand-olive-800 text-white font-bold text-xs shadow-cardHover transition-all flex items-center justify-center space-x-1.5"
                      >
                        <span>Open Workspace</span>
                        <ArrowLeft className="w-3.5 h-3.5 rotate-180" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* View Mode 2: Specific Subject Workspace */}
        {viewMode === 'workspace' && selectedSubject && (
          <div className="space-y-6">
            {/* Subject Context Header */}
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-card flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-brand-blue-950/40 text-brand-blue-300 border border-brand-blue-800/50">
                    {selectedSubject.code}
                  </span>
                  <h2 className="text-base font-bold text-white">{selectedSubject.name}</h2>
                </div>
                <p className="text-xs text-slate-400 font-mono">
                  Year {selectedSubject.year} • Branch: <strong className="text-white">{selectedSubject.branch?.name}</strong> • Enrolled Students: <strong className="text-white">{students.length}</strong>
                </p>
              </div>

              <button
                onClick={openCreateModal}
                className="px-4 py-2 rounded-control bg-brand-olive-700 hover:bg-brand-olive-800 text-white font-bold text-xs shadow-card flex items-center space-x-1.5 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create Programming Exam</span>
              </button>
            </div>

            {/* Exam status summary strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-slate-800/80 rounded-control p-3 flex items-center space-x-2">
                <Hourglass className="w-4 h-4 text-amber-500" />
                <div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white">{statusCounts.UPCOMING}</div>
                  <div className="text-[10px] text-slate-500">Upcoming</div>
                </div>
              </div>
              <div className="bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-slate-800/80 rounded-control p-3 flex items-center space-x-2">
                <PlayCircle className="w-4 h-4 text-emerald-500" />
                <div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white">{statusCounts.RUNNING}</div>
                  <div className="text-[10px] text-slate-500">Running</div>
                </div>
              </div>
              <div className="bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-slate-800/80 rounded-control p-3 flex items-center space-x-2">
                <Clock className="w-4 h-4 text-slate-400" />
                <div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white">{statusCounts.COMPLETED}</div>
                  <div className="text-[10px] text-slate-500">Completed</div>
                </div>
              </div>
              <div className="bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-slate-800/80 rounded-control p-3 flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 text-rose-500" />
                <div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white">{violations.length}</div>
                  <div className="text-[10px] text-slate-500">Violations Logged</div>
                </div>
              </div>
            </div>

            {/* Workspace sub-tabs — the sidebar covers these on desktop, so they render
                only where the sidebar is a drawer rather than always visible. */}
            <div className="lg:hidden flex items-center gap-2 border-b border-slate-200 dark:border-slate-800/80 pb-3 overflow-x-auto">
              <button
                onClick={() => setActiveMainTab('labs')}
                className={`px-4 py-2 rounded-control text-xs font-semibold transition-all flex items-center space-x-2 flex-shrink-0 ${
                  activeMainTab === 'labs' ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-card' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Exams ({labs.length})</span>
              </button>

              <button
                onClick={() => setActiveMainTab('students')}
                className={`px-4 py-2 rounded-control text-xs font-semibold transition-all flex items-center space-x-2 flex-shrink-0 ${
                  activeMainTab === 'students' ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-card' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <GraduationCap className="w-3.5 h-3.5" />
                <span>Enrolled Students ({students.length})</span>
              </button>

              <button
                onClick={() => setActiveMainTab('submissions')}
                className={`px-4 py-2 rounded-control text-xs font-semibold transition-all flex items-center space-x-2 flex-shrink-0 ${
                  activeMainTab === 'submissions' ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-card' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <CheckCircle className="w-3.5 h-3.5" />
                <span>Submissions & Grading ({submissions.length})</span>
              </button>

              <button
                onClick={() => setActiveMainTab('violations')}
                className={`px-4 py-2 rounded-control text-xs font-semibold transition-all flex items-center space-x-2 flex-shrink-0 ${
                  activeMainTab === 'violations' ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-card' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Violation Logs ({violations.length})</span>
              </button>
            </div>

            {/* Tab 1: Exams */}
            {activeMainTab === 'labs' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {labs.length === 0 ? (
                  <div className="col-span-full">
                    <Card>
                      <EmptyState
                        icon={<BookOpen className="w-5 h-5" />}
                        title="No examinations yet"
                        description={`Create your first examination for ${selectedSubject.name} to configure its answer sheet and question sets.`}
                      />
                    </Card>
                  </div>
                ) : (
                  labs.map((lab) => (
                    <Card key={lab.id} interactive className="p-5 flex flex-col justify-between gap-4">
                      <div className="space-y-2">
                        {lab.scheduleProblem && (
                          <Alert tone="warning">{lab.scheduleProblem}</Alert>
                        )}
                        <div className="flex items-center justify-between">
                          <StatusBadge tone={EXAM_STATUS_TONE[lab.status] || 'neutral'}>{lab.status}</StatusBadge>
                          {/* Every action is labelled and sits in a 36px target. Delete is
                              pulled away from edit by a divider and carries a destructive
                              hover state, so the irreversible action is never the one you
                              hit by accident. */}
                          <div className="flex items-center gap-0.5">
                            <button
                              onClick={() => setQuestionSetsLab(lab)}
                              title="Question sets"
                              aria-label={`Question sets for ${lab.title}`}
                              className="p-2 rounded-control text-slate-400 hover:text-indigo-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                              <Layers className="w-4 h-4" aria-hidden="true" />
                            </button>
                            <button
                              onClick={() => openEditModal(lab)}
                              title="Edit exam"
                              aria-label={`Edit ${lab.title}`}
                              className="p-2 rounded-control text-slate-400 hover:text-brand-blue-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                              <Edit2 className="w-4 h-4" aria-hidden="true" />
                            </button>
                            <span aria-hidden="true" className="mx-1 h-4 w-px bg-slate-200 dark:bg-slate-700" />
                            {lab.archivedAt ? (
                              <button
                                onClick={() => openRetireDialog(lab)}
                                title="Restore exam"
                                aria-label={`Restore ${lab.title} to active examinations`}
                                className="p-2 rounded-control text-slate-400 hover:text-brand-olive-600 hover:bg-brand-olive-50 dark:hover:bg-brand-olive-900/30 transition-colors"
                              >
                                <ArchiveRestore className="w-4 h-4" aria-hidden="true" />
                              </button>
                            ) : lab.canDelete === false ? (
                              <button
                                onClick={() => openRetireDialog(lab)}
                                title="Archive exam"
                                aria-label={`Archive ${lab.title} — it holds student work and cannot be deleted`}
                                className="p-2 rounded-control text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-colors"
                              >
                                <Archive className="w-4 h-4" aria-hidden="true" />
                              </button>
                            ) : (
                              <button
                                onClick={() => openRetireDialog(lab)}
                                title="Delete exam"
                                aria-label={`Delete ${lab.title} permanently`}
                                className="p-2 rounded-control text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </div>

                        <h3 className="font-bold text-base text-slate-900 dark:text-white">{lab.title}</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{lab.description}</p>

                        <div className="flex flex-wrap gap-2 text-[10px] font-mono text-slate-500 dark:text-slate-400">
                          {lab.startTime && <span>Starts: {new Date(lab.startTime).toLocaleString()}</span>}
                          {lab.durationMinutes && <span>• {lab.durationMinutes} min</span>}
                          {typeof lab.allowedLanguages === 'string' && <span>• {lab.allowedLanguages.split(',').join(', ')}</span>}
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs text-slate-400 border-t border-slate-100 dark:border-slate-800 pt-3">
                        <div className="flex items-center space-x-3 font-mono text-[11px]">
                          <span className="flex items-center space-x-1"><Users className="w-3 h-3" /><span>{lab.appearedCount ?? 0} appeared</span></span>
                          <span className="text-emerald-500">{lab.submittedCount ?? 0} submitted</span>
                          <span className="text-amber-500">{lab.pendingCount ?? 0} pending</span>
                        </div>
                        <button onClick={() => setActiveMainTab('submissions')} className="text-brand-blue-600 dark:text-brand-blue-400 font-semibold hover:underline">
                          View submissions &rarr;
                        </button>
                      </div>

                      {/* Result release. Shown only once an exam has submissions to release,
                          so a draft or an untaken exam is not cluttered with an action that
                          cannot apply. State is named in text, never by colour alone. */}
                      {(lab.releaseReadiness?.totalSubmissions ?? 0) > 0 && (
                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800 pt-3">
                          <div className="flex items-center gap-2">
                            <StatusBadge tone={lab.resultsReleasedAt ? 'emerald' : 'neutral'}>
                              {RELEASE_STATE_LABEL[releaseState(lab.resultsReleasedAt)]}
                            </StatusBadge>
                            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              {lab.releaseReadiness.graded} graded · {lab.releaseReadiness.ungraded} pending
                            </span>
                          </div>
                          {!lab.resultsReleasedAt && (
                            <Button
                              variant="outline"
                              onClick={() => openReleaseDialog(lab)}
                              aria-label={`Release results for ${lab.title}`}
                            >
                              <Send className="w-3.5 h-3.5" aria-hidden="true" />
                              Release results
                            </Button>
                          )}
                        </div>
                      )}
                    </Card>
                  ))
                )}
              </div>
            )}

            {/* Tab 2: Enrolled Students */}
            {activeMainTab === 'students' && (
              students.length === 0 ? (
                <Card>
                  <EmptyState icon={<Users className="w-5 h-5" />} title="No students enrolled" description={`No students are registered for ${selectedSubject.name} yet.`} />
                </Card>
              ) : (
                <Card className="overflow-hidden">
                  <TableWrap minWidth="520px">
                    <THead>
                      <tr>
                        <Th>Roll number</Th>
                        <Th>Student</Th>
                        <Th>Year</Th>
                        <Th>Branch</Th>
                      </tr>
                    </THead>
                    <TBody>
                      {students.map((st) => (
                        <Tr key={st.id}>
                          <Td className="font-mono font-bold text-slate-900 dark:text-white">{st.rollNumber}</Td>
                          <Td className="font-semibold text-slate-900 dark:text-white">{st.name}</Td>
                          <Td>Year {st.year}</Td>
                          <Td>{st.branchName}</Td>
                        </Tr>
                      ))}
                    </TBody>
                  </TableWrap>
                </Card>
              )
            )}

            {activeMainTab === 'submissions' && (
              submissions.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={<ClipboardCheck className="w-5 h-5" />}
                    title="No submissions yet"
                    description={`Submissions for ${selectedSubject.name} appear here once students submit their examinations.`}
                  />
                </Card>
              ) : (
                <>
                  {/* Below lg the evaluation queue is a card list: a seven-column table on a
                      narrow screen is unreadable, and this is the evaluator's main surface. */}
                  <div className="lg:hidden space-y-3">
                    {submissions.map((sub) => (
                      <Card key={sub.id} className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-bold text-sm text-slate-900 dark:text-white font-mono">{sub.studentRollNumber}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{sub.studentName}</p>
                          </div>
                          <StatusBadge tone={EXAM_STATUS_TONE[sub.status] || 'amber'}>{sub.status}</StatusBadge>
                        </div>
                        <p className="text-xs text-slate-700 dark:text-slate-300">{sub.labTitle}</p>
                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-slate-900 dark:text-white tabular">
                              {sub.marks !== null ? `${sub.marks}/${sub.maxMarks ?? 100}` : 'Ungraded'}
                            </span>
                            {sub.violationCount > 0 && <StatusBadge tone="rose">{sub.violationCount} flags</StatusBadge>}
                            {sub.autoSubmitted && <StatusBadge tone="amber">Auto</StatusBadge>}
                          </div>
                          <Button size="sm" variant="secondary" onClick={() => setSelectedSubmission(sub)}>
                            Inspect
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>

                  <Card className="hidden lg:block overflow-hidden">
                    <TableWrap minWidth="760px">
                      <THead>
                        <tr>
                          <Th>Roll number</Th>
                          <Th>Student</Th>
                          <Th>Examination</Th>
                          <Th>Status</Th>
                          <Th>Integrity</Th>
                          <Th className="text-right">Marks</Th>
                          <Th className="text-right">Action</Th>
                        </tr>
                      </THead>
                      <TBody>
                        {submissions.map((sub) => (
                          <Tr key={sub.id}>
                            <Td className="font-mono font-bold text-slate-900 dark:text-white">{sub.studentRollNumber}</Td>
                            <Td className="font-semibold text-slate-900 dark:text-white">{sub.studentName}</Td>
                            <Td>
                              <span className="flex items-center gap-1.5">
                                {sub.labTitle}
                                {sub.autoSubmitted && <StatusBadge tone="amber">Auto</StatusBadge>}
                              </span>
                            </Td>
                            <Td><StatusBadge tone={EXAM_STATUS_TONE[sub.status] || 'amber'}>{sub.status}</StatusBadge></Td>
                            <Td>
                              {sub.violationCount > 0 ? (
                                <StatusBadge tone="rose">{sub.violationCount}</StatusBadge>
                              ) : (
                                <span className="text-slate-400 text-[11px]">Clean</span>
                              )}
                            </Td>
                            <Td className="text-right font-bold text-slate-900 dark:text-white tabular">
                              {sub.marks !== null ? `${sub.marks}/${sub.maxMarks ?? 100}` : '—'}
                            </Td>
                            <Td className="text-right">
                              <Button size="sm" variant="secondary" onClick={() => setSelectedSubmission(sub)}>
                                Inspect &amp; grade
                              </Button>
                            </Td>
                          </Tr>
                        ))}
                      </TBody>
                    </TableWrap>
                  </Card>
                </>
              )
            )}

            {/* Tab 4: Integrity log */}
            {activeMainTab === 'violations' && (
              violations.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={<ShieldAlert className="w-5 h-5" />}
                    title="No integrity events"
                    description={`Nothing has been flagged for ${selectedSubject.name}. Events appear here as students sit examinations.`}
                  />
                </Card>
              ) : (
                <>
                  <div className="lg:hidden space-y-3">
                    {violations.map((v) => (
                      <Card key={v.id} className="p-4 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-bold text-sm text-slate-900 dark:text-white">{v.studentName}</p>
                            <p className="text-[11px] font-mono text-slate-500">{v.rollNumber}</p>
                          </div>
                          <StatusBadge tone="rose">{v.type}</StatusBadge>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400">{v.examTitle}</p>
                        <p className="text-[11px] text-slate-500 font-mono">{new Date(v.createdAt).toLocaleString()}</p>
                      </Card>
                    ))}
                  </div>

                  <Card className="hidden lg:block overflow-hidden">
                    <TableWrap minWidth="720px">
                      <THead>
                        <tr>
                          <Th>Student</Th>
                          <Th>Roll number</Th>
                          <Th>Examination</Th>
                          <Th>Event</Th>
                          <Th>When</Th>
                          <Th className="text-right">Count</Th>
                        </tr>
                      </THead>
                      <TBody>
                        {violations.map((v) => (
                          <Tr key={v.id}>
                            <Td className="font-semibold text-slate-900 dark:text-white">{v.studentName}</Td>
                            <Td className="font-mono font-bold text-slate-900 dark:text-white">{v.rollNumber}</Td>
                            <Td>{v.examTitle}</Td>
                            <Td><StatusBadge tone="rose">{v.type}</StatusBadge></Td>
                            <Td className="text-slate-500 tabular">{new Date(v.createdAt).toLocaleString()}</Td>
                            <Td className="text-right font-bold text-slate-900 dark:text-white tabular">{v.violationCount}</Td>
                          </Tr>
                        ))}
                      </TBody>
                    </TableWrap>
                  </Card>
                </>
              )
            )}
          </div>
        )}
      </AppShell>

      {notification && (
        <UiToast tone={notification.type === 'success' ? 'success' : 'error'} message={notification.message} onDismiss={() => setNotification(null)} />
      )}

      {/* Modal: Create/Edit Programming Exam */}
      {showLabModal && (
        <Modal
          open={showLabModal}
          onClose={() => setShowLabModal(false)}
          title={editingLabId ? 'Edit examination' : 'Create examination'}
          description="Configure the examination and its answer sheet here. Question sets, previews and student assignment are managed from the examination's Question sets action once it exists."
          size="lg"
          // An exam being authored holds a lot of unsaved configuration; a stray click on the
          // backdrop must not discard it.
          dismissOnBackdrop={false}
        >
            <form className="space-y-3">
              <input type="text" placeholder="Exam Name" value={labTitle} onChange={(e) => setLabTitle(e.target.value)} required className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-control px-3 py-2 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 transition-colors" />
              <input type="text" placeholder="Short Description" value={labDesc} onChange={(e) => setLabDesc(e.target.value)} className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-control px-3 py-2 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 transition-colors" />
              <textarea placeholder="Programming Question / Problem Statement" value={labProblem} onChange={(e) => setLabProblem(e.target.value)} rows={4} required className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-control px-3 py-2 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 transition-colors leading-relaxed resize-y" />

              {/* Scheduling */}
              <div className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-4">
                <div>
                  <label className="text-xs font-bold text-slate-900 dark:text-white block">Schedule</label>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">When the examination opens, closes, and how long each student gets.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">Date</label>
                    <input type="date" value={examDateInput} onChange={(e) => setExamDateInput(e.target.value)} className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-control px-3 py-2 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 transition-colors" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">Start Time</label>
                    <input type="time" value={startTimeInput} onChange={(e) => setStartTimeInput(e.target.value)} className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-control px-3 py-2 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 transition-colors" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">End Time <span className="text-slate-400">(optional if a duration is set)</span></label>
                    <input type="time" value={endTimeInput} onChange={(e) => setEndTimeInput(e.target.value)} className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-control px-3 py-2 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 transition-colors" />
                  </div>
                </div>
                {(() => {
                  // Live summary of what will actually be stored, so an AM/PM slip is visible
                  // before saving instead of when the exam closes at its start time.
                  const startIso = combineDateTime(examDateInput, startTimeInput);
                  const endIso = combineDateTime(examDateInput, endTimeInput);
                  if (!startIso) return null;
                  const problems = validateExamSchedule({ startTime: startIso, endTime: endIso, durationMinutes: durationMinutesInput, examModeEnabled });
                  const windowEnd = getExamWindowEnd({ startTime: startIso, endTime: endIso, durationMinutes: durationMinutesInput ? Number(durationMinutesInput) : null });
                  const fmt = (d: Date) => d.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
                  return problems.length > 0 ? (
                    <p role="alert" className="text-[11px] text-rose-600 dark:text-rose-400">{problems[0]}</p>
                  ) : windowEnd ? (
                    <p className="text-[11px] text-slate-600 dark:text-slate-400" aria-live="polite">
                      Open from <strong>{fmt(new Date(startIso))}</strong> to <strong>{fmt(windowEnd)}</strong>
                      {` (${Math.round((windowEnd.getTime() - new Date(startIso).getTime()) / 60000)} min window`}
                      {durationMinutesInput ? `; each student gets ${durationMinutesInput} min from when they start)` : ')'}
                    </p>
                  ) : null;
                })()}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">Duration (minutes)</label>
                    <input type="number" min={1} placeholder="e.g. 90" value={durationMinutesInput} onChange={(e) => setDurationMinutesInput(e.target.value)} className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-control px-3 py-2 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 transition-colors" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">Fullscreen Exit Threshold</label>
                    <input type="number" min={1} value={fullscreenThresholdInput} onChange={(e) => setFullscreenThresholdInput(e.target.value)} className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-control px-3 py-2 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 transition-colors" />
                  </div>
                </div>
              </div>

              {/* Allowed languages */}
              <div className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-4">
                <div>
                  <label className="text-xs font-bold text-slate-900 dark:text-white block">Allowed languages</label>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Students may only create source files in the languages you select.</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  {LANGUAGE_OPTIONS.map((lang) => (
                    <label key={lang.value} className="flex items-center space-x-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5">
                      <input type="checkbox" checked={selectedLanguages.includes(lang.value)} onChange={() => toggleLanguage(lang.value)} />
                      <span className="text-slate-700 dark:text-slate-300">{lang.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Exam mode + anti-cheat */}
              <div className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-4">
                <div>
                  <label className="text-xs font-bold text-slate-900 dark:text-white block">Integrity &amp; devices</label>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">How the attempt is monitored, and what a student may do during it.</p>
                </div>
                <label className="flex items-center space-x-2 text-xs font-semibold text-slate-900 dark:text-white">
                  <input type="checkbox" checked={examModeEnabled} onChange={(e) => setExamModeEnabled(e.target.checked)} />
                  <span>Enable Secure Exam Mode (fullscreen, tab-switch &amp; devtools monitoring)</span>
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                  <label className="flex items-center space-x-2"><input type="checkbox" checked={allowCopy} onChange={(e) => setAllowCopy(e.target.checked)} /><span>Allow Copy</span></label>
                  <label className="flex items-center space-x-2"><input type="checkbox" checked={allowPaste} onChange={(e) => setAllowPaste(e.target.checked)} /><span>Allow Paste</span></label>
                </div>

                <label className="flex items-start space-x-2 text-xs font-semibold text-slate-900 dark:text-white pt-1">
                  <input type="checkbox" checked={requireDesktopDevice} onChange={(e) => setRequireDesktopDevice(e.target.checked)} className="mt-0.5" />
                  <span>
                    Require a computer to sit this exam
                    <span className="block font-normal text-[10px] text-slate-500 dark:text-slate-400">
                      Blocks phones and tablets from starting or continuing an attempt, checked on the server. Students can still
                      use a phone for their dashboard, notices and results.
                    </span>
                  </span>
                </label>
              </div>

              <AnswerSheetConfigurator
                drafts={sectionDrafts}
                onChange={setSectionDrafts}
                startedAttempts={editingLabAttempts}
              />

              <div className="flex justify-end space-x-2 pt-2">
                <button type="button" onClick={() => setShowLabModal(false)} className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-control border border-slate-300 dark:border-slate-700 bg-white dark:bg-transparent hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors">Cancel</button>
                <button type="button" disabled={saving} onClick={(e) => handleSaveLab(e, false)} className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-control border border-slate-300 dark:border-slate-700 bg-white dark:bg-transparent hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors disabled:opacity-50">Save Draft</button>
                <button type="button" disabled={saving} onClick={(e) => handleSaveLab(e, true)} className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-control bg-brand-olive-700 hover:bg-brand-olive-600 text-white text-xs font-semibold shadow-card transition-colors disabled:opacity-50">
                  {editingLabId ? 'Save & publish' : 'Publish examination'}
                </button>
              </div>
            </form>
        </Modal>
      )}

      {questionSetsLab && (
        <QuestionSetManager
          labId={questionSetsLab.id}
          labTitle={questionSetsLab.title}
          token={token || ''}
          onClose={() => setQuestionSetsLab(null)}
          onChanged={fetchWorkspaceData}
        />
      )}

      {/* Submission Inspector Modal */}
      {selectedSubmission && (
        <Modal
          open
          onClose={() => setSelectedSubmission(null)}
          title={`${selectedSubmission.studentRollNumber} — ${selectedSubmission.studentName}`}
          description="Review the submitted record, code and integrity signals, then award marks."
          size="full"
          fullHeight
          // Grading holds typed marks and remarks; a stray backdrop click must not lose them.
          dismissOnBackdrop={false}
        >
          <div className="flex flex-col h-full -m-4 sm:-m-5">
            <div className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3.5 flex items-start sm:items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                <span className="font-mono font-bold text-slate-900 dark:text-white text-base">{selectedSubmission.studentRollNumber}</span>
                <span className="text-slate-600 dark:text-slate-300 font-semibold text-sm">{selectedSubmission.studentName}</span>
                {selectedSubmission.autoSubmitted && <StatusBadge tone="amber">Auto-submitted</StatusBadge>}
                {/* Faculty-facing only — the student is never shown which set they sat. */}
                {selectedSubmission.questionSetLabel && (
                  <StatusBadge tone="indigo">{selectedSubmission.questionSetLabel}</StatusBadge>
                )}
                {selectedSubmission.startDeviceClass && (
                  <StatusBadge tone="neutral">{selectedSubmission.startDeviceClass}</StatusBadge>
                )}
                {/* What is shown is the latest immutable hand-in; its hash is re-verified server-side. */}
                {selectedSubmission.snapshots?.[0] && (
                  <StatusBadge tone={selectedSubmission.snapshots[0].verified ? 'emerald' : 'rose'}>
                    {`Hand-in v${selectedSubmission.snapshots[0].version} · ${selectedSubmission.snapshots[0].verified ? 'integrity verified' : 'INTEGRITY CHECK FAILED'}`}
                  </StatusBadge>
                )}
                {selectedSubmission.snapshots?.[0] && !selectedSubmission.snapshots[0].onTime && (
                  <StatusBadge tone="amber">Handed in after the deadline</StatusBadge>
                )}
                {(selectedSubmission.snapshots?.length || 0) > 1 && (
                  <span className="text-[11px] text-slate-500" title={selectedSubmission.snapshots.map((s: any) => `v${s.version} ${new Date(s.submittedAt).toLocaleString()} ${s.contentHash.slice(0, 12)}`).join('\n')}>
                    {selectedSubmission.snapshots.length} versions
                  </span>
                )}
              </div>
              <button onClick={() => setSelectedSubmission(null)} className="px-3 py-1 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white rounded-control text-xs font-bold">Close</button>
            </div>

            <div className="flex-1 flex flex-col md:flex-row overflow-hidden p-4 gap-4">
              <div className="flex-1 h-full overflow-hidden flex flex-col min-h-0">
                {/* Always shown now: the Runs tab applies whether or not the exam has an answer sheet. */}
                <div className="flex items-center gap-2 mb-2 flex-shrink-0" role="tablist" aria-label="Submission views">
                  {(selectedSubmission.answerSheet?.length || 0) > 0 && (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={inspectorPane === 'sheet'}
                      onClick={() => setInspectorPane('sheet')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${inspectorPane === 'sheet' ? 'bg-brand-blue-600 border-brand-blue-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'}`}
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Answer Sheet</span>
                    </button>
                  )}
                  <button
                    type="button"
                    role="tab"
                    aria-selected={inspectorPane === 'code' || (inspectorPane === 'sheet' && !(selectedSubmission.answerSheet?.length > 0))}
                    onClick={() => setInspectorPane('code')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${inspectorPane === 'code' || (inspectorPane === 'sheet' && !(selectedSubmission.answerSheet?.length > 0)) ? 'bg-brand-olive-700 border-brand-olive-600 text-white' : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'}`}
                  >
                    <Code className="w-3.5 h-3.5" />
                    <span>Code</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={inspectorPane === 'runs'}
                    onClick={() => setInspectorPane('runs')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${inspectorPane === 'runs' ? 'bg-brand-blue-600 border-brand-blue-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'}`}
                  >
                    <TerminalSquare className="w-3.5 h-3.5" />
                    <span>Runs</span>
                  </button>
                </div>

                {(selectedSubmission.answerSheet?.length || 0) > 0 && inspectorPane === 'sheet' ? (
                  <div className="flex-1 min-h-0 overflow-y-auto bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-card p-5 space-y-5">
                    {selectedSubmission.problemStatement && (
                      <div className="space-y-1.5 border-b border-slate-800 pb-4">
                        <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300">Question</h4>
                        <p className="text-[11px] text-slate-600 dark:text-slate-400 whitespace-pre-wrap leading-relaxed">{selectedSubmission.problemStatement}</p>
                      </div>
                    )}

                    {selectedSubmission.answerSheet.map((section: any, i: number) => (
                      <div key={section.id} className="space-y-1.5">
                        <h4 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
                          <span className="text-slate-500 font-mono">{i + 1}.</span>
                          <span>{section.label}</span>
                          {section.maxMarks !== null && (
                            <span className="text-[10px] font-semibold text-slate-400 bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5">
                              {section.maxMarks} marks
                            </span>
                          )}
                        </h4>

                        {section.contentSource === 'CODE_FILES' ? (
                          <p className="text-[11px] text-slate-500 italic">
                            See the Code tab — {(selectedSubmission.files || []).length} file(s) submitted.
                          </p>
                        ) : section.content.trim() ? (
                          <p
                            className={`text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-control p-3 ${section.contentSource === 'EXECUTION_IO' ? 'font-mono' : ''}`}
                          >
                            {section.content}
                          </p>
                        ) : (
                          <p className="text-[11px] text-rose-600 dark:text-rose-400/80 italic">
                            Left blank{section.required ? ' (required section)' : ''}.
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : inspectorPane === 'runs' ? (
                  <div className="flex-1 min-h-0 overflow-y-auto bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-card p-4">
                    <RunHistory
                      submissionId={selectedSubmission.id}
                      token={token}
                      outputSectionText={
                        (selectedSubmission.answerSheet || []).find((sec: any) => sec.key === 'OUTPUT')?.content ?? null
                      }
                    />
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <OnlineIDE labId={selectedSubmission.labId} labTitle={selectedSubmission.labTitle} problemStatement="" readOnly={true} initialFiles={selectedSubmission.files || []} isSubmitted={true} fillParent />
                  </div>
                )}
              </div>

              <div className="w-full md:w-80 flex flex-col space-y-4 overflow-y-auto">
                {integrityStatus && (
                  <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-card p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-xs text-white flex items-center space-x-1.5">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        <span>Integrity Timeline</span>
                      </h4>
                      <StatusBadge tone={integrityStatus === 'FLAGGED' ? 'rose' : integrityStatus === 'WARNING' ? 'amber' : 'emerald'}>
                        {integrityStatus}
                      </StatusBadge>
                    </div>
                    {timelineEvents.length === 0 ? (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">No events recorded.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-64 overflow-y-auto">
                        {timelineEvents.map((ev) => (
                          <div key={ev.id} className="flex items-center space-x-2 text-[10px] font-mono">
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${SEVERITY_DOT_STYLES[ev.severity] || SEVERITY_DOT_STYLES.LOW}`} />
                            <span className="text-slate-300 flex-1">{ev.label}</span>
                            <span className="text-slate-500">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-card p-5 flex flex-col justify-between space-y-4">
                  <form onSubmit={handleEvaluateSubmission} className="space-y-4" noValidate>
                    <h4 className="font-bold text-sm text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-800 pb-2">Grading Panel</h4>
                    <Field label="Status" htmlFor="eval-status">
                      <Select id="eval-status" value={evalStatus} onChange={(e) => setEvalStatus(e.target.value)}>
                        <option value="APPROVED">Approved</option>
                        <option value="REJECTED">Rejected</option>
                        <option value="NEEDS_CORRECTION">Needs correction (reopens the attempt)</option>
                        <option value="PENDING">Pending (not yet decided)</option>
                      </Select>
                    </Field>

                    {gradingSections.length > 0 ? (
                      <fieldset className="space-y-3">
                        <legend className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Section marks</legend>
                        {gradingSections.map((sec: any) => {
                          const entry = evalSectionMarks[sec.id] || { marks: '', remarks: '' };
                          const n = entry.marks === '' ? null : Number(entry.marks);
                          const invalid = n !== null && (!Number.isFinite(n) || n < 0 || n > sec.maxMarks);
                          return (
                            <div key={sec.id} className="space-y-1.5">
                              <div className="flex items-center gap-2">
                                <label htmlFor={`sec-${sec.id}`} className="flex-1 min-w-0 text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                                  {sec.label}
                                </label>
                                {/* Fixed-width wrapper: cn() does not de-conflict classes, so a width on the
                                    Input itself loses to the primitive's w-full and hides the label. */}
                                <div className="w-20 flex-shrink-0">
                                <Input
                                  id={`sec-${sec.id}`}
                                  type="number"
                                  inputMode="decimal"
                                  min={0}
                                  max={sec.maxMarks}
                                  step="0.5"
                                  value={entry.marks}
                                  invalid={invalid}
                                  aria-describedby={`sec-${sec.id}-max`}
                                  onChange={(e) => setEvalSectionMarks((m) => ({ ...m, [sec.id]: { ...entry, marks: e.target.value } }))}
                                  className="text-right tabular"
                                />
                                </div>
                                <span id={`sec-${sec.id}-max`} className="text-xs text-slate-500 tabular w-10 flex-shrink-0">/ {sec.maxMarks}</span>
                              </div>
                              <Input
                                aria-label={`Remark for ${sec.label} (optional)`}
                                placeholder="Remark (optional)"
                                value={entry.remarks}
                                onChange={(e) => setEvalSectionMarks((m) => ({ ...m, [sec.id]: { ...entry, remarks: e.target.value } }))}
                                className="text-[11px]"
                              />
                              {invalid && <p className="text-[11px] text-rose-600 dark:text-rose-400">Enter 0–{sec.maxMarks}.</p>}
                            </div>
                          );
                        })}
                        <div className="flex items-baseline justify-between border-t border-slate-200 dark:border-slate-800 pt-2" aria-live="polite">
                          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Total</span>
                          <span className="text-sm font-bold tabular text-slate-900 dark:text-white">
                            {sectionPreview.total !== null
                              ? `${sectionPreview.total} / ${sectionPreview.maxTotal}`
                              : `${gradingSections.filter((sec) => (evalSectionMarks[sec.id]?.marks ?? '') !== '').length} of ${gradingSections.length} sections marked`}
                          </span>
                        </div>
                      </fieldset>
                    ) : (
                      <Field label={`Marks (out of ${selectedSubmission.maxMarks ?? 100})`} htmlFor="eval-marks">
                        <Input
                          id="eval-marks"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={selectedSubmission.maxMarks ?? 100}
                          step="0.5"
                          value={evalMarks}
                          onChange={(e) => setEvalMarks(e.target.value)}
                        />
                      </Field>
                    )}

                    <Field label="Remarks" htmlFor="eval-remarks">
                      <Textarea id="eval-remarks" placeholder="Feedback for the student…" value={evalRemarks} onChange={(e) => setEvalRemarks(e.target.value)} rows={3} />
                    </Field>

                    {finalStatusBlocked && (
                      <Alert tone="warning">Mark every section to save a final status, or choose Pending to keep partial marks.</Alert>
                    )}
                    {sectionPreview.errors.length > 0 && <Alert tone="danger">{sectionPreview.errors[0]}</Alert>}

                    <Button type="submit" className="w-full" disabled={finalStatusBlocked || sectionPreview.errors.length > 0}>
                      Save evaluation
                    </Button>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      {selectedSubmission?.resultsReleasedAt
                        ? 'Results for this exam are released — saving makes this mark visible to the student immediately.'
                        : 'This mark stays private until you release results for this exam.'}
                    </p>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {releasingLab && (
        <ResultReleaseDialog
          open={!!releasingLab}
          onClose={closeReleaseDialog}
          examTitle={releasingLab.title}
          readiness={releasingLab.releaseReadiness ?? NO_SUBMISSIONS}
          busy={releasing}
          serverRefusal={releaseRefusal}
          onConfirm={handleReleaseResults}
        />
      )}

      {retiringLab && (
        <ExamRetirementDialog
          open={!!retiringLab}
          onClose={closeRetireDialog}
          examTitle={retiringLab.title}
          activity={retiringLab.activity}
          archived={!!retiringLab.archivedAt}
          busy={retiring}
          serverRefusal={retireRefusal}
          onConfirm={handleRetireExam}
        />
      )}

      <ProfileModal isOpen={profileOpen} onClose={() => setProfileOpen(false)} />
    </>
  );
}
