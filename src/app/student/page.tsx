'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { Navbar } from '@/components/Navbar';
import { ProfileModal } from '@/components/ProfileModal';
import {
  GraduationCap,
  BookOpen,
  Award,
  Clock,
  Calendar,
  Timer,
  Code2,
  User as UserIcon,
  CheckCircle,
  Hourglass,
  PlayCircle,
} from 'lucide-react';

const LANGUAGE_LABELS: Record<string, string> = {
  c: 'C',
  cpp: 'C++',
  java: 'Java',
  python: 'Python',
};

const STATUS_STYLES: Record<string, string> = {
  UPCOMING: 'bg-slate-800 text-slate-300 border border-slate-700',
  RUNNING: 'bg-emerald-950/40 text-emerald-300 border border-emerald-800/50',
  COMPLETED: 'bg-slate-800 text-slate-400 border border-slate-700',
};

export default function StudentDashboard() {
  const router = useRouter();
  const { user, token, loading } = useApp();

  const [activeTab, setActiveTab] = useState<'upcoming' | 'running' | 'completed' | 'results'>('running');
  const [profileOpen, setProfileOpen] = useState(false);

  const [studentInfo, setStudentInfo] = useState<{ year: number; branchName: string; branchId?: string } | null>(null);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [grades, setGrades] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'STUDENT')) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (token) {
      fetchStudentLabs();
      fetchGrades();
    }
  }, [token]);

  const fetchStudentLabs = async () => {
    try {
      const res = await fetch('/api/student/labs', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setStudentInfo(data.studentInfo);
        setSubjects(data.subjects || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingData(false);
    }
  };

  const fetchGrades = async () => {
    try {
      const res = await fetch('/api/student/grades', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setGrades(data.grades || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Flatten every exam across subjects, tagged with its subject/lecturer context.
  const allExams = useMemo(() => {
    const flat: any[] = [];
    for (const sub of subjects) {
      for (const lab of sub.labs) {
        flat.push({ ...lab, subjectName: sub.name, subjectCode: sub.code, facultyName: sub.lecturer?.name || 'Unassigned' });
      }
    }
    return flat;
  }, [subjects]);

  const upcomingExams = allExams.filter((e) => e.status === 'UPCOMING');
  const runningExams = allExams.filter((e) => e.status === 'RUNNING');
  const completedExams = allExams.filter((e) => e.status === 'COMPLETED');

  const tabExams =
    activeTab === 'upcoming' ? upcomingExams : activeTab === 'running' ? runningExams : activeTab === 'completed' ? completedExams : [];

  if (loading || !user) {
    return <div className="min-h-screen bg-surface-darkBg flex items-center justify-center text-white font-mono text-xs">Loading Student Portal...</div>;
  }

  const renderExamCard = (lab: any) => {
    const languages = (lab.allowedLanguages || []).map((l: string) => LANGUAGE_LABELS[l] || l).join(', ');
    const buttonLabel = lab.isSubmitted ? 'View Submission' : lab.hasStarted ? 'Resume Exam' : lab.status === 'RUNNING' ? 'Start Exam' : 'Locked';
    const buttonDisabled = lab.status !== 'RUNNING' && !lab.isSubmitted;

    return (
      <div
        key={lab.id}
        className="bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 shadow-sm flex flex-col justify-between space-y-3 transition-all hover:border-brand-olive-600/50 hover:shadow-md"
      >
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-brand-blue-950/40 text-brand-blue-300 border border-brand-blue-800/50">
              {lab.subjectCode}
            </span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${STATUS_STYLES[lab.status] || STATUS_STYLES.UPCOMING}`}>
              {lab.status}
            </span>
          </div>

          <h3 className="font-bold text-sm text-slate-900 dark:text-white">{lab.title}</h3>

          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono pt-1">
            <div className="flex items-center space-x-1.5">
              <UserIcon className="w-3 h-3 text-brand-blue-500 flex-shrink-0" />
              <span className="truncate">{lab.facultyName}</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <Calendar className="w-3 h-3 text-brand-olive-500 flex-shrink-0" />
              <span>{lab.examDate ? new Date(lab.examDate).toLocaleDateString() : lab.startTime ? new Date(lab.startTime).toLocaleDateString() : 'TBD'}</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <Timer className="w-3 h-3 text-amber-500 flex-shrink-0" />
              <span>{lab.durationMinutes ? `${lab.durationMinutes} min` : 'No limit'}</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <Code2 className="w-3 h-3 text-purple-500 flex-shrink-0" />
              <span className="truncate">{languages || 'Any'}</span>
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-200/60 dark:border-slate-700/40 flex items-center justify-between">
          {lab.marks !== null ? (
            <div className="text-xs font-mono font-bold text-emerald-400">
              Grade: {lab.marks}/{lab.maxMarks}
            </div>
          ) : (
            <div className="text-[11px] text-slate-400">
              {lab.isSubmitted ? 'Submitted' : lab.hasStarted ? 'In Progress' : 'Not Started'}
            </div>
          )}

          {buttonDisabled ? (
            <span className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-500 text-xs font-semibold cursor-not-allowed">
              {buttonLabel}
            </span>
          ) : (
            <Link
              href={`/student/lab/${lab.id}`}
              className="px-3.5 py-1.5 rounded-lg bg-brand-olive-700 hover:bg-brand-olive-800 text-white text-xs font-semibold transition-all shadow-sm flex items-center space-x-1.5"
            >
              {lab.hasStarted && !lab.isSubmitted ? <PlayCircle className="w-3.5 h-3.5" /> : <Code2 className="w-3.5 h-3.5" />}
              <span>{buttonLabel}</span>
            </Link>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-surface-lightBg dark:bg-surface-darkBg flex flex-col transition-colors">
      <Navbar onOpenProfile={() => setProfileOpen(true)} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Student Welcome Header */}
        <div className="bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-slate-800/80 rounded-2xl p-6 sm:p-8 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <GraduationCap className="w-5 h-5 text-slate-700 dark:text-slate-300" />
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Welcome, {user.name}</h1>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
              Roll Number: <span className="font-bold text-slate-900 dark:text-slate-100">{user.rollNumber}</span> • Academic Year: <span className="font-bold text-slate-900 dark:text-slate-100">Year {studentInfo?.year || user.studentProfile?.year || 1}</span> • Branch: <span className="font-bold text-slate-900 dark:text-slate-100">{studentInfo?.branchName || 'Assigned Branch'}</span>
            </p>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center space-x-2 border-b border-slate-200 dark:border-slate-800/80 pb-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab('running')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center space-x-2 flex-shrink-0 ${
              activeTab === 'running' ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <PlayCircle className="w-3.5 h-3.5" />
            <span>Running Exams ({runningExams.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('upcoming')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center space-x-2 flex-shrink-0 ${
              activeTab === 'upcoming' ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Hourglass className="w-3.5 h-3.5" />
            <span>Upcoming Exams ({upcomingExams.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('completed')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center space-x-2 flex-shrink-0 ${
              activeTab === 'completed' ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Completed Exams ({completedExams.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('results')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center space-x-2 flex-shrink-0 ${
              activeTab === 'results' ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Award className="w-3.5 h-3.5" />
            <span>Results</span>
          </button>
        </div>

        {/* Tab Content: Exam lists */}
        {activeTab !== 'results' && (
          <div className="space-y-4">
            {loadingData ? (
              <div className="text-center py-12 text-slate-500 font-mono text-xs">Loading programming exams...</div>
            ) : tabExams.length === 0 ? (
              <div className="bg-white dark:bg-surface-darkCard p-8 rounded-2xl border border-slate-200 dark:border-slate-800 text-center space-y-2">
                <BookOpen className="w-10 h-10 text-slate-400 mx-auto" />
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                  No {activeTab === 'running' ? 'Running' : activeTab === 'upcoming' ? 'Upcoming' : 'Completed'} Exams
                </h3>
                <p className="text-xs text-slate-500">
                  {activeTab === 'running'
                    ? 'No programming exams are currently active for you.'
                    : activeTab === 'upcoming'
                    ? 'No exams are scheduled yet.'
                    : 'No exams have concluded yet.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{tabExams.map(renderExamCard)}</div>
            )}
          </div>
        )}

        {/* Tab Content: Results */}
        {activeTab === 'results' && (
          <div className="bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-slate-800/80 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="p-4">Programming Exam</th>
                    <th className="p-4">Submitted At</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Score</th>
                    <th className="p-4">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {grades.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-400 font-sans">No published results yet.</td>
                    </tr>
                  ) : (
                    grades.map((g) => (
                      <tr key={g.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="p-4 font-sans font-bold text-slate-900 dark:text-white">{g.labTitle}</td>
                        <td className="p-4 text-slate-500">{new Date(g.submittedAt).toLocaleDateString()}</td>
                        <td className="p-4">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950/40 text-emerald-300 border border-emerald-800/50">
                            {g.status}
                          </span>
                        </td>
                        <td className="p-4 font-bold text-emerald-400">{g.marks !== null ? `${g.marks}/${g.maxMarks}` : 'Ungraded'}</td>
                        <td className="p-4 font-sans text-slate-400">{g.remarks || 'No remarks'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      <ProfileModal isOpen={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
