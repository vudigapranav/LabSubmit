'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { Navbar } from '@/components/Navbar';
import { Card, StatusBadge } from '@/components/ui';
import {
  GraduationCap,
  ArrowRight,
  FileText,
  Layers,
  EyeOff,
  TerminalSquare,
  ClipboardCheck,
  ShieldCheck,
  Laptop,
  Smartphone,
  Award,
  Settings2,
  PenLine,
  Send,
} from 'lucide-react';

// The public entry point to LabSubmit.
//
// Every capability named on this page is one the application actually implements — the
// answer-sheet configurator, question sets and their random assignment, the execution
// engine, the integrity log, the device restriction and manual evaluation. Nothing here
// advertises auto-grading, persisted execution records or per-section mark roll-up, because
// those do not exist. A landing page that overstates the product is a defect, not marketing.

const WORKFLOW: { label: string; detail: string }[] = [
  { label: 'Configure the examination', detail: 'Schedule, duration, languages and integrity rules.' },
  { label: 'Customise the answer sheet', detail: 'Choose the sections, their order, headings and required state.' },
  { label: 'Author question sets', detail: 'As many sets as you need, each with its own questions.' },
  { label: 'Assign at random', detail: 'Each student is given one set, spread evenly across the cohort.' },
  { label: 'Student completes the record', detail: 'The structured lab record, rendered as the lecturer configured it.' },
  { label: 'Write and run code', detail: 'A real terminal, compiling and running interactively.' },
  { label: 'Submit', detail: 'Required sections checked; timeouts still capture the work.' },
  { label: 'Evaluate', detail: 'A human reviews the record, the code and the integrity signals.' },
  { label: 'Publish results', detail: 'Marks and remarks released under the lecturer’s control.' },
];

const CAPABILITIES: { icon: React.ReactNode; title: string; body: string }[] = [
  {
    icon: <FileText className="w-[18px] h-[18px]" />,
    title: 'Customisable answer sheets',
    body: 'One sheet, not many formats. The lecturer decides which of the nine sections an examination uses, in what order, under what heading, and which are mandatory.',
  },
  {
    icon: <Layers className="w-[18px] h-[18px]" />,
    title: 'Randomised question sets',
    body: 'Author several sets per examination, each holding as many questions as you choose. The platform assigns one to each student at random and pins it for the whole attempt.',
  },
  {
    icon: <EyeOff className="w-[18px] h-[18px]" />,
    title: 'Hidden set identity',
    body: 'Students see their questions and nothing else — no set name, no set number, no indication that other sets exist. The identity is stripped server-side, not hidden in the interface.',
  },
  {
    icon: <TerminalSquare className="w-[18px] h-[18px]" />,
    title: 'Live code execution',
    body: 'C, C++, Java and Python compile and run in a real interactive terminal, so programs that prompt for input behave exactly as they would locally.',
  },
  {
    icon: <PenLine className="w-[18px] h-[18px]" />,
    title: 'Input and output in the record',
    body: 'What a program was given and what it printed can be taken straight from the run into the Input and Output sections, rather than retyped from memory.',
  },
  {
    icon: <ShieldCheck className="w-[18px] h-[18px]" />,
    title: 'Examination integrity',
    body: 'Fullscreen enforcement, tab-switch and developer-tool detection, duplicate-session checks and an auditable event log — with severity decided on the server.',
  },
  {
    icon: <Laptop className="w-[18px] h-[18px]" />,
    title: 'Desktop-only attempts',
    body: 'An active examination can only be started and continued on a laptop or desktop. The check is made server-side, and exam content is withheld from an ineligible device rather than merely hidden.',
  },
  {
    icon: <ClipboardCheck className="w-[18px] h-[18px]" />,
    title: 'Human evaluation',
    body: 'There is no auto-grading. An evaluator reviews the written record, the code and the integrity timeline together, then awards marks and remarks.',
  },
  {
    icon: <Smartphone className="w-[18px] h-[18px]" />,
    title: 'Works on every device',
    body: 'Dashboards, schedules, submissions and results are usable on a phone. Only the live examination itself is restricted.',
  },
];

export default function Home() {
  const router = useRouter();
  const { user, loading } = useApp();
  const [logoError, setLogoError] = useState(false);

  // Signed-in visitors go straight to their workspace — unchanged behaviour.
  useEffect(() => {
    if (!loading && user) {
      if (user.role === 'ADMIN') router.push('/admin');
      else if (user.role === 'LECTURER') router.push('/lecturer');
      else if (user.role === 'STUDENT') router.push('/student');
    }
  }, [user, loading, router]);

  const primaryCta =
    'inline-flex items-center justify-center gap-2 px-6 py-3 rounded-control bg-brand-olive-700 hover:bg-brand-olive-600 text-white font-semibold text-sm shadow-card transition-colors';
  const secondaryCta =
    'inline-flex items-center justify-center gap-2 px-6 py-3 rounded-control bg-white dark:bg-transparent hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 font-semibold text-sm transition-colors';

  return (
    <div className="min-h-screen bg-surface-lightBg dark:bg-surface-darkBg flex flex-col">
      <Navbar
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="hidden sm:inline-flex items-center px-3 py-1.5 rounded-control text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="inline-flex items-center px-3 py-1.5 rounded-control bg-brand-olive-700 hover:bg-brand-olive-600 text-white text-xs font-semibold shadow-card transition-colors"
            >
              Register
            </Link>
          </div>
        }
      />

      <main className="flex-1">
        {/* ------------------------------------------------------------- Hero */}
        <section className="px-4 sm:px-6 lg:px-8 pt-12 sm:pt-20 pb-12 sm:pb-16">
          <div className="max-w-3xl mx-auto text-center space-y-6 animate-slide-up">
            <div className="flex justify-center">
              {!logoError ? (
                <Image
                  src="/cbit-logo.png"
                  alt="Chaitanya Bharathi Institute of Technology"
                  width={64}
                  height={64}
                  className="object-contain w-auto h-14 sm:h-16"
                  onError={() => setLogoError(true)}
                  priority
                />
              ) : (
                <div className="w-14 h-14 rounded-card bg-brand-olive-700 text-white flex items-center justify-center font-bold text-lg">
                  CBIT
                </div>
              )}
            </div>

            <p className="text-[11px] sm:text-xs font-semibold uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">
              Chaitanya Bharathi Institute of Technology
            </p>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 dark:text-white">
              LabSubmit
            </h1>

            {/* States what the product is, and why it is useful, in one breath. */}
            <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl mx-auto">
              A digital laboratory examination and evaluation platform. Run an invigilated lab exam end to end —
              the written record, the code, the execution and the marking — in one place, instead of on paper
              and a compiler.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <Link href="/login" className={`${primaryCta} w-full sm:w-auto`}>
                Sign in to LabSubmit
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </Link>
              <Link href="/register" className={`${secondaryCta} w-full sm:w-auto`}>
                <GraduationCap className="w-4 h-4" aria-hidden="true" />
                Student registration
              </Link>
            </div>

            <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-1">
              Students register with an institute roll number authorised by the administrator.
            </p>
          </div>
        </section>

        {/* --------------------------------------------- What LabSubmit does */}
        <section aria-labelledby="what-heading" className="px-4 sm:px-6 lg:px-8 py-12 sm:py-16 border-t border-slate-200 dark:border-slate-800">
          <div className="max-w-5xl mx-auto">
            <div className="max-w-2xl space-y-3">
              <StatusBadge tone="olive">What it is</StatusBadge>
              <h2 id="what-heading" className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                An examination platform, not an online editor
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                A programming lab exam is more than the code. It is a structured record — an aim, an algorithm, the
                program, the input it was given, the output it produced, a conclusion — sat under invigilation and
                marked by a human. LabSubmit runs that whole examination. The editor is one part of it.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
              {[
                { icon: <Settings2 className="w-5 h-5" />, title: 'Lecturers configure', body: 'The format of the answer sheet, the question sets, the schedule and the integrity rules are all set per examination.' },
                { icon: <PenLine className="w-5 h-5" />, title: 'Students record', body: 'The digital equivalent of the lab record book, rendered exactly as the lecturer configured it, alongside a real terminal.' },
                { icon: <Award className="w-5 h-5" />, title: 'Evaluators mark', body: 'The complete submission — record, code and integrity signals — reviewed in one place, then marks published.' },
              ].map((c) => (
                <Card key={c.title} className="p-5 space-y-2.5">
                  <span className="inline-flex w-9 h-9 rounded-control bg-brand-olive-50 dark:bg-brand-olive-900/30 text-brand-olive-700 dark:text-brand-olive-400 items-center justify-center">
                    {c.icon}
                  </span>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">{c.title}</h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{c.body}</p>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------ The workflow */}
        <section aria-labelledby="flow-heading" className="px-4 sm:px-6 lg:px-8 py-12 sm:py-16 border-t border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-surface-darkCard/30">
          <div className="max-w-5xl mx-auto">
            <div className="max-w-2xl space-y-3">
              <StatusBadge tone="blue">The workflow</StatusBadge>
              <h2 id="flow-heading" className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                One examination, end to end
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Every examination follows the same pipeline. Each step is part of a single flow rather than a
                separate tool.
              </p>
            </div>

            {/* An ordered list is the honest markup for a sequence, and reads correctly to a
                screen reader as "1 of 9". */}
            <ol className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {WORKFLOW.map((step, i) => (
                <li key={step.label}>
                  <Card className="p-4 h-full flex gap-3">
                    <span
                      aria-hidden="true"
                      className="flex-shrink-0 w-7 h-7 rounded-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-[11px] font-bold flex items-center justify-center tabular"
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 space-y-0.5">
                      <h3 className="text-xs font-bold text-slate-900 dark:text-white">{step.label}</h3>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{step.detail}</p>
                    </div>
                  </Card>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---------------------------------------------------- Capabilities */}
        <section aria-labelledby="caps-heading" className="px-4 sm:px-6 lg:px-8 py-12 sm:py-16 border-t border-slate-200 dark:border-slate-800">
          <div className="max-w-5xl mx-auto">
            <div className="max-w-2xl space-y-3">
              <StatusBadge tone="neutral">Capabilities</StatusBadge>
              <h2 id="caps-heading" className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                What the platform does today
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Everything listed here is implemented and in use — not a roadmap.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-8">
              {CAPABILITIES.map((c) => (
                <Card key={c.title} className="p-5 space-y-2.5">
                  <span className="inline-flex w-9 h-9 rounded-control bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 items-center justify-center">
                    {c.icon}
                  </span>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">{c.title}</h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{c.body}</p>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* -------------------------------------------------- Integrity note */}
        <section aria-labelledby="integrity-heading" className="px-4 sm:px-6 lg:px-8 py-12 sm:py-16 border-t border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-surface-darkCard/30">
          <div className="max-w-3xl mx-auto">
            <Card className="p-5 sm:p-7 space-y-3">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex w-9 h-9 rounded-control bg-brand-blue-50 dark:bg-brand-blue-900/30 text-brand-blue-700 dark:text-brand-blue-400 items-center justify-center">
                  <ShieldCheck className="w-[18px] h-[18px]" />
                </span>
                <h2 id="integrity-heading" className="text-lg font-bold text-slate-900 dark:text-white">
                  Integrity, described honestly
                </h2>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Exam state is decided on the server: timing, eligibility, submission and violation severity are never
                taken on the client&apos;s word. Attempts are restricted to laptops and desktops, and exam content is
                withheld from an ineligible device rather than hidden in the interface.
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                A browser cannot prove what hardware it runs on, so the device check raises the effort required to sit
                an exam on an unsupported device — it is a deterrent alongside the integrity log, not an attestation.
                LabSubmit is built to support invigilation, not to replace it.
              </p>
            </Card>
          </div>
        </section>

        {/* ---------------------------------------------------------- The CTA */}
        <section className="px-4 sm:px-6 lg:px-8 py-12 sm:py-16 border-t border-slate-200 dark:border-slate-800">
          <div className="max-w-2xl mx-auto text-center space-y-5">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
              Ready to begin?
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Faculty and administrators sign in with their institute account. Students register with an authorised
              roll number.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link href="/login" className={`${primaryCta} w-full sm:w-auto`}>
                Sign in
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </Link>
              <Link href="/register" className={`${secondaryCta} w-full sm:w-auto`}>
                <Send className="w-4 h-4" aria-hidden="true" />
                Create a student account
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 dark:border-slate-800 px-4 sm:px-6 lg:px-8 py-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            &copy; {new Date().getFullYear()} Chaitanya Bharathi Institute of Technology. All rights reserved.
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            LabSubmit — digital laboratory examination &amp; evaluation
          </p>
        </div>
      </footer>
    </div>
  );
}
