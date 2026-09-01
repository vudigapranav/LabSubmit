'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useApp } from '@/context/AppContext';
import { cn } from './ui';
import {
  LayoutDashboard,
  PlayCircle,
  Hourglass,
  CheckCircle2,
  Award,
  FileText,
  Users,
  Layers,
  ClipboardCheck,
  ShieldAlert,
  Building2,
  BookOpen,
  GraduationCap,
  School,
  Shield,
  Menu,
  X,
  Sun,
  Moon,
  LogOut,
  User as UserIcon,
} from 'lucide-react';

// The LabSubmit application shell: persistent sidebar on desktop, slide-over drawer on
// mobile, with a compact top bar.
//
// Navigation deliberately maps to destinations that ACTUALLY EXIST. LabSubmit keeps each
// role's views as tabs inside one route, so a sidebar item selects a section within the
// current page rather than linking to an invented page. Nothing here creates a route that
// the application does not serve.
//
// The active examination does NOT use this shell — an exam must be distraction-free, and
// navigation away from a live attempt is exactly what the shell would invite.

export interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

export interface NavSection {
  heading?: string;
  items: NavItem[];
}

const ICON = 'w-[18px] h-[18px]';

/** Student sections — these mirror the tabs the student dashboard already renders. */
export const STUDENT_NAV: NavSection[] = [
  {
    items: [
      { id: 'running', label: 'Active Exams', icon: <PlayCircle className={ICON} /> },
      { id: 'upcoming', label: 'Upcoming Exams', icon: <Hourglass className={ICON} /> },
      { id: 'completed', label: 'Submissions', icon: <CheckCircle2 className={ICON} /> },
      { id: 'results', label: 'Results', icon: <Award className={ICON} /> },
    ],
  },
];

/** Lecturer sections — mirror the faculty workspace tabs. */
export const LECTURER_NAV: NavSection[] = [
  {
    items: [
      { id: 'assignments', label: 'My Subjects', icon: <LayoutDashboard className={ICON} /> },
      { id: 'labs', label: 'Examinations', icon: <FileText className={ICON} /> },
      { id: 'students', label: 'Students', icon: <Users className={ICON} /> },
      { id: 'submissions', label: 'Evaluations', icon: <ClipboardCheck className={ICON} /> },
      { id: 'violations', label: 'Integrity Log', icon: <ShieldAlert className={ICON} /> },
    ],
  },
];

/** Admin sections — mirror the control-centre tabs. */
export const ADMIN_NAV: NavSection[] = [
  {
    items: [
      { id: 'branches', label: 'Branches', icon: <Building2 className={ICON} /> },
      { id: 'subjects', label: 'Subjects', icon: <BookOpen className={ICON} /> },
      { id: 'lecturers', label: 'Faculty', icon: <School className={ICON} /> },
      { id: 'students', label: 'Students', icon: <GraduationCap className={ICON} /> },
      { id: 'labs', label: 'Examinations', icon: <Layers className={ICON} /> },
    ],
  },
];

const ROLE_META: Record<string, { label: string; icon: React.ReactNode }> = {
  ADMIN: { label: 'Administrator', icon: <Shield className="w-3 h-3" /> },
  LECTURER: { label: 'Faculty', icon: <School className="w-3 h-3" /> },
  STUDENT: { label: 'Student', icon: <GraduationCap className="w-3 h-3" /> },
};

interface AppShellProps {
  sections: NavSection[];
  active: string;
  onNavigate: (id: string) => void;
  /** Shown above the sidebar navigation, e.g. the subject a lecturer is working inside. */
  contextLabel?: string;
  onOpenProfile?: () => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  sections,
  active,
  onNavigate,
  contextLabel,
  onOpenProfile,
  children,
}) => {
  const { user, theme, toggleTheme, logout } = useApp();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [logoError, setLogoError] = useState(false);

  // Selecting a section on mobile should dismiss the drawer; leaving it open would hide
  // the content the user just asked for.
  const go = (id: string) => {
    onNavigate(id);
    setDrawerOpen(false);
  };

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const roleMeta = user ? ROLE_META[user.role] : null;

  const brand = (
    <Link href="/" className="flex items-center gap-2.5 group min-w-0">
      <div className="w-9 h-9 flex items-center justify-center flex-shrink-0">
        {!logoError ? (
          <Image src="/cbit-logo.png" alt="" width={36} height={36} className="object-contain w-auto h-9" onError={() => setLogoError(true)} priority />
        ) : (
          <div className="w-9 h-9 rounded-control bg-brand-olive-700 text-white flex items-center justify-center font-bold text-[10px]">CBIT</div>
        )}
      </div>
      <div className="min-w-0">
        <p className="font-bold text-sm text-slate-900 dark:text-white leading-tight truncate">LabSubmit</p>
        <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight truncate">CBIT Laboratory Platform</p>
      </div>
    </Link>
  );

  const nav = (
    <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
      {contextLabel && (
        <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 truncate">{contextLabel}</p>
      )}
      {sections.map((section, i) => (
        <div key={i} className="space-y-1">
          {section.heading && (
            <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{section.heading}</p>
          )}
          {section.items.map((item) => {
            const isActive = item.id === active;
            return (
              <button
                key={item.id}
                onClick={() => go(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 rounded-control text-xs font-semibold transition-colors text-left',
                  isActive
                    ? 'bg-brand-olive-50 dark:bg-brand-olive-900/30 text-brand-olive-800 dark:text-brand-olive-300'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
                )}
              >
                {/* An active item is marked by an accent bar as well as colour, so the
                    state does not depend on colour perception alone. */}
                <span className={cn('w-0.5 h-5 rounded-full flex-shrink-0 -ml-1', isActive ? 'bg-brand-olive-600' : 'bg-transparent')} aria-hidden="true" />
                <span className={cn('flex-shrink-0', isActive ? 'text-brand-olive-700 dark:text-brand-olive-400' : 'text-slate-400 dark:text-slate-500')}>
                  {item.icon}
                </span>
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );

  const footer = (
    <div className="border-t border-slate-200 dark:border-slate-800 p-3 space-y-1">
      {user && (
        <div className="flex items-center gap-2.5 px-2 py-2 min-w-0">
          <div className="w-8 h-8 rounded-full bg-brand-olive-700 text-white flex items-center justify-center text-xs font-bold flex-shrink-0" aria-hidden="true">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{user.name}</p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono flex items-center gap-1 truncate">
              {roleMeta?.icon}
              {user.role === 'STUDENT' ? user.rollNumber : roleMeta?.label}
            </p>
          </div>
        </div>
      )}

      {onOpenProfile && (
        <button
          onClick={() => {
            onOpenProfile();
            setDrawerOpen(false);
          }}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-control text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white transition-colors"
        >
          <UserIcon className={cn(ICON, 'text-slate-400 dark:text-slate-500')} />
          Profile &amp; Settings
        </button>
      )}

      <button
        onClick={toggleTheme}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-control text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white transition-colors"
      >
        {theme === 'light' ? <Moon className={cn(ICON, 'text-slate-400')} /> : <Sun className={cn(ICON, 'text-amber-400')} />}
        {theme === 'light' ? 'Dark mode' : 'Light mode'}
      </button>

      <button
        onClick={logout}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-control text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-700 dark:hover:text-rose-400 transition-colors"
      >
        <LogOut className={cn(ICON, 'text-slate-400 dark:text-slate-500')} />
        Log out
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-surface-lightBg dark:bg-surface-darkBg">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-sidebar flex-col bg-white dark:bg-surface-darkCard border-r border-slate-200 dark:border-slate-800 z-30">
        <div className="h-16 flex items-center px-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">{brand}</div>
        {nav}
        {footer}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <>
          <div className="lg:hidden fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 animate-fade-in" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <aside className="lg:hidden fixed inset-y-0 left-0 w-72 max-w-[85vw] flex flex-col bg-white dark:bg-surface-darkCard border-r border-slate-200 dark:border-slate-800 z-50 animate-slide-in-left">
            <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
              {brand}
              <button onClick={() => setDrawerOpen(false)} aria-label="Close navigation" className="p-1.5 rounded-control text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            {nav}
            {footer}
          </aside>
        </>
      )}

      {/* Content column, offset by the sidebar on large screens */}
      <div className="lg:pl-sidebar flex flex-col min-h-screen">
        <header className="sticky top-0 z-20 h-16 bg-white/90 dark:bg-surface-darkCard/90 backdrop-blur border-b border-slate-200 dark:border-slate-800 flex items-center gap-3 px-3 sm:px-6 flex-shrink-0">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            className="lg:hidden p-2 rounded-control text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Menu className="w-5 h-5" aria-hidden="true" />
          </button>

          <div className="lg:hidden min-w-0 flex-1">
            <p className="font-bold text-sm text-slate-900 dark:text-white truncate">LabSubmit</p>
          </div>

          <div className="hidden lg:block min-w-0 flex-1">
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {contextLabel || 'Chaitanya Bharathi Institute of Technology'}
            </p>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              className="p-2 rounded-control text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {theme === 'light' ? <Moon className="w-4 h-4" aria-hidden="true" /> : <Sun className="w-4 h-4 text-amber-400" aria-hidden="true" />}
            </button>
            {onOpenProfile && (
              <button
                onClick={onOpenProfile}
                aria-label="Profile and settings"
                className="p-2 rounded-control text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <UserIcon className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 px-3 sm:px-6 lg:px-8 py-5 sm:py-7">
          <div className="max-w-6xl mx-auto space-y-5 sm:space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
};
