'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { ProfileModal } from '@/components/ProfileModal';
import { AppShell, STUDENT_NAV } from '@/components/AppShell';
import {
  Button,
  Card,
  EmptyState,
  EXAM_STATUS_TONE,
  LoadingState,
  PageHeader,
  StatCard,
  StatusBadge,
  TableWrap,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@/components/ui';
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
    return (
      <div className="min-h-screen bg-surface-lightBg dark:bg-surface-darkBg flex items-center justify-center">
        <LoadingState label="Loading your portal…" />
      </div>
    );
  }

  const submittedCount = allExams.filter((e) => e.isSubmitted).length;
  const publishedGrades = grades.filter((g) => g.marks !== null);
  const averageScore =
    publishedGrades.length > 0
      ? Math.round(publishedGrades.reduce((sum, g) => sum + (g.marks / (g.maxMarks || 100)) * 100, 0) / publishedGrades.length)
      : null;

  const renderExamCard = (lab: any) => {
    const languages = (lab.allowedLanguages || []).map((l: string) => LANGUAGE_LABELS[l] || l).join(', ');
    const buttonLabel = lab.isSubmitted ? 'View submission' : lab.hasStarted ? 'Resume exam' : lab.status === 'RUNNING' ? 'Start exam' : 'Locked';
    const buttonDisabled = lab.status !== 'RUNNING' && !lab.isSubmitted;

    return (
      <Card key={lab.id} interactive className="p-4 sm:p-5 flex flex-col justify-between gap-4">
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <StatusBadge tone="blue">{lab.subjectCode}</StatusBadge>
            <StatusBadge tone={EXAM_STATUS_TONE[lab.status] || 'neutral'}>{lab.status}</StatusBadge>
          </div>

          <h3 className="font-bold text-sm text-slate-900 dark:text-white leading-snug">{lab.title}</h3>

          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-slate-500 dark:text-slate-400 pt-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <UserIcon className="w-3 h-3 text-brand-blue-500 flex-shrink-0" aria-hidden="true" />
              <dt className="sr-only">Faculty</dt>
              <dd className="truncate">{lab.facultyName}</dd>
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
              <Calendar className="w-3 h-3 text-brand-olive-600 flex-shrink-0" aria-hidden="true" />
              <dt className="sr-only">Date</dt>
              <dd className="truncate">
                {lab.examDate ? new Date(lab.examDate).toLocaleDateString() : lab.startTime ? new Date(lab.startTime).toLocaleDateString() : 'To be announced'}
              </dd>
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
              <Timer className="w-3 h-3 text-amber-500 flex-shrink-0" aria-hidden="true" />
              <dt className="sr-only">Duration</dt>
              <dd className="truncate">{lab.durationMinutes ? `${lab.durationMinutes} min` : 'No limit'}</dd>
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
              <Code2 className="w-3 h-3 text-brand-blue-500 flex-shrink-0" aria-hidden="true" />
              <dt className="sr-only">Languages</dt>
              <dd className="truncate">{languages || 'Any'}</dd>
            </div>
          </dl>
        </div>

        <div className="pt-3 border-t border-slate-200/70 dark:border-slate-800/70 flex items-center justify-between gap-2">
          {lab.marks !== null ? (
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 tabular">
              {lab.marks}/{lab.maxMarks}
            </span>
          ) : (
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {lab.isSubmitted ? 'Submitted' : lab.hasStarted ? 'In progress' : 'Not started'}
            </span>
          )}

          {buttonDisabled ? (
            <Button size="sm" variant="outline" disabled>
              {buttonLabel}
            </Button>
          ) : (
            <Link
              href={`/student/lab/${lab.id}`}
              className="inline-flex items-center justify-center gap-1.5 font-semibold rounded-control transition-colors text-xs px-3 py-1.5 bg-brand-olive-700 hover:bg-brand-olive-600 text-white shadow-card"
            >
              {lab.hasStarted && !lab.isSubmitted ? <PlayCircle className="w-3.5 h-3.5" aria-hidden="true" /> : <Code2 className="w-3.5 h-3.5" aria-hidden="true" />}
              {buttonLabel}
            </Link>
          )}
        </div>
      </Card>
    );
  };

  const TAB_COPY: Record<string, { title: string; description: string; emptyTitle: string; emptyBody: string }> = {
    running: {
      title: 'Active examinations',
      description: 'Examinations open right now. Starting one begins your personal countdown.',
      emptyTitle: 'No examinations are open',
      emptyBody: 'When your faculty opens an examination it will appear here, ready to start.',
    },
    upcoming: {
      title: 'Upcoming examinations',
      description: 'Scheduled examinations that have not opened yet.',
      emptyTitle: 'Nothing scheduled',
      emptyBody: 'Upcoming examinations for your branch and year will be listed here.',
    },
    completed: {
      title: 'Submissions',
      description: 'Examinations whose window has closed, and the work you submitted.',
      emptyTitle: 'No submissions yet',
      emptyBody: 'Examinations you have completed will be collected here.',
    },
    results: {
      title: 'Results',
      description: 'Marks and remarks your faculty has published.',
      emptyTitle: 'No published results yet',
      emptyBody: 'Results appear once your faculty has evaluated and published them.',
    },
  };

  const copy = TAB_COPY[activeTab];

  return (
    <>
      <AppShell
        sections={STUDENT_NAV}
        active={activeTab}
        onNavigate={(id) => setActiveTab(id as typeof activeTab)}
        onOpenProfile={() => setProfileOpen(true)}
      >
        <PageHeader
          title={`Welcome, ${user.name.split(' ')[0]}`}
          description="Your laboratory examinations, submissions and results."
          meta={
            <>
              <span>Roll {user.rollNumber}</span>
              <span>Year {studentInfo?.year || user.studentProfile?.year || 1}</span>
              <span>{studentInfo?.branchName || 'Branch pending'}</span>
            </>
          }
        />

        {/* Compact statistics: what a student most wants to know at a glance. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard label="Active now" value={runningExams.length} tone={runningExams.length > 0 ? 'olive' : 'neutral'} icon={<PlayCircle className="w-4 h-4" />} hint={runningExams.length > 0 ? 'Open for you' : 'Nothing open'} />
          <StatCard label="Upcoming" value={upcomingExams.length} icon={<Hourglass className="w-4 h-4" />} hint="Scheduled" />
          <StatCard label="Submitted" value={submittedCount} tone="blue" icon={<CheckCircle className="w-4 h-4" />} hint="Across all subjects" />
          <StatCard label="Average" value={averageScore !== null ? `${averageScore}%` : '—'} tone={averageScore !== null ? 'emerald' : 'neutral'} icon={<Award className="w-4 h-4" />} hint={publishedGrades.length > 0 ? `${publishedGrades.length} published` : 'Awaiting results'} />
        </div>

        {/* Section heading mirrors the sidebar selection, so the page always says where you are. */}
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">{copy.title}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{copy.description}</p>
          </div>

          {loadingData ? (
            <Card>
              <LoadingState label="Loading your examinations…" />
            </Card>
          ) : activeTab === 'results' ? (
            grades.length === 0 ? (
              <Card>
                <EmptyState icon={<Award className="w-5 h-5" />} title={copy.emptyTitle} description={copy.emptyBody} />
              </Card>
            ) : (
              <>
                {/* Cards below md, table above — a five-column table is unusable on a phone,
                    and results are the screen students check most from one. */}
                <div className="md:hidden space-y-3">
                  {grades.map((g) => (
                    <Card key={g.id} className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-bold text-sm text-slate-900 dark:text-white min-w-0">{g.labTitle}</h3>
                        <StatusBadge tone={EXAM_STATUS_TONE[g.status] || 'neutral'}>{g.status}</StatusBadge>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400 tabular">
                          {g.marks !== null ? `${g.marks}/${g.maxMarks}` : 'Ungraded'}
                        </span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">{new Date(g.submittedAt).toLocaleDateString()}</span>
                      </div>
                      {g.remarks && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800 pt-2">{g.remarks}</p>
                      )}
                    </Card>
                  ))}
                </div>

                <Card className="hidden md:block overflow-hidden">
                  <TableWrap>
                    <THead>
                      <tr>
                        <Th>Examination</Th>
                        <Th>Submitted</Th>
                        <Th>Status</Th>
                        <Th className="text-right">Score</Th>
                        <Th>Remarks</Th>
                      </tr>
                    </THead>
                    <TBody>
                      {grades.map((g) => (
                        <Tr key={g.id}>
                          <Td className="font-semibold text-slate-900 dark:text-white">{g.labTitle}</Td>
                          <Td className="text-slate-500 tabular">{new Date(g.submittedAt).toLocaleDateString()}</Td>
                          <Td>
                            <StatusBadge tone={EXAM_STATUS_TONE[g.status] || 'neutral'}>{g.status}</StatusBadge>
                          </Td>
                          <Td className="text-right font-bold text-emerald-600 dark:text-emerald-400 tabular">
                            {g.marks !== null ? `${g.marks}/${g.maxMarks}` : '—'}
                          </Td>
                          <Td className="text-slate-500 max-w-xs truncate">{g.remarks || '—'}</Td>
                        </Tr>
                      ))}
                    </TBody>
                  </TableWrap>
                </Card>
              </>
            )
          ) : tabExams.length === 0 ? (
            <Card>
              <EmptyState icon={<BookOpen className="w-5 h-5" />} title={copy.emptyTitle} description={copy.emptyBody} />
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{tabExams.map(renderExamCard)}</div>
          )}
        </div>
      </AppShell>

      <ProfileModal isOpen={profileOpen} onClose={() => setProfileOpen(false)} />
    </>
  );
}
