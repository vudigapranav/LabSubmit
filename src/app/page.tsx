'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { Navbar } from '@/components/Navbar';
import { Card } from '@/components/ui';
import { LandingPreview } from '@/components/LandingPreview';
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
        {/* An asymmetric split rather than a centred stack: the argument of the page is
            that a lab exam is a record AND code, so the product view has to be visible in
            the first screen, not described above the fold and shown below it. */}
        <section className="px-4 sm:px-6 lg:px-8 pt-12 sm:pt-16 lg:pt-20 pb-14 sm:pb-20">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)] gap-10 lg:gap-14 items-center">
            <div className="space-y-6">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Chaitanya Bharathi Institute of Technology
              </p>

              {/* Says what it does for whom. The product name is the wordmark in the bar
                  above; it does not need to be the headline as well. */}
              <h1 className="text-[40px] sm:text-5xl lg:text-[56px] leading-[1.05] font-medium tracking-tight text-slate-900 dark:text-white text-balance">
                Run the whole lab exam, not just the code
              </h1>

              <p className="text-lg leading-relaxed text-slate-600 dark:text-slate-300 max-w-[36rem]">
                LabSubmit is a digital laboratory examination platform. The written record, the
                compiler, the invigilation and the marking sit in one place, instead of on paper
                beside a terminal.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 pt-1">
                <Link href="/login" className={primaryCta}>
                  Sign in
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </Link>
                <Link href="/register" className={secondaryCta}>
                  <GraduationCap className="w-4 h-4" aria-hidden="true" />
                  Student registration
                </Link>
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                Students register with an institute roll number authorised by the administrator
              </p>
            </div>

            <LandingPreview />
          </div>
        </section>

        {/* ------------------------- What it is, and the sequence it runs in */}
        {/* The thesis and the pipeline were two sections of near-identical cards saying
            overlapping things. They are one section now: the argument on the left, the
            nine steps as a dense ordered list on the right. Numbers earn their place here
            because this really is a sequence — step 4 cannot happen before step 3. */}
        <section aria-labelledby="what-heading" className="px-4 sm:px-6 lg:px-8 py-16 sm:py-20 border-t border-slate-200 dark:border-slate-800">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-10 lg:gap-16">
            <div className="space-y-4">
              <h2 id="what-heading" className="text-3xl font-medium tracking-tight text-slate-900 dark:text-white text-balance">
                An examination platform, not an online editor
              </h2>
              <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                A programming lab exam is more than the code. It is a structured record — an aim,
                an algorithm, the program, the input it was given, the output it produced, a
                conclusion — sat under invigilation and marked by a human. LabSubmit runs that
                whole examination. The editor is one part of it.
              </p>
              <dl className="pt-2 space-y-3 text-sm">
                <div>
                  <dt className="text-slate-900 dark:text-white">Lecturers configure</dt>
                  <dd className="text-slate-600 dark:text-slate-400">The answer sheet, the question sets, the schedule and the integrity rules, per examination.</dd>
                </div>
                <div>
                  <dt className="text-slate-900 dark:text-white">Students record</dt>
                  <dd className="text-slate-600 dark:text-slate-400">The lab record book, rendered exactly as the lecturer configured it, beside a real terminal.</dd>
                </div>
                <div>
                  <dt className="text-slate-900 dark:text-white">Evaluators mark</dt>
                  <dd className="text-slate-600 dark:text-slate-400">Record, code and integrity signals reviewed together, then results released.</dd>
                </div>
              </dl>
            </div>

            <div>
              <h3 className="text-sm text-slate-500 dark:text-slate-400 mb-5">
                Every examination follows the same nine steps
              </h3>
              <ol className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-0">
                {WORKFLOW.map((step, i) => (
                  <li
                    key={step.label}
                    className="flex gap-4 py-3 border-b border-slate-200/70 dark:border-slate-800/70"
                  >
                    <span aria-hidden="true" className="font-mono text-xs text-slate-400 dark:text-slate-600 tabular pt-0.5">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div className="min-w-0">
                      <h4 className="text-sm text-slate-900 dark:text-white">{step.label}</h4>
                      <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{step.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------- Capabilities */}
        {/* Nine bordered cards in a grid read as a template and made every capability look
            equally weighted. The same nine, kept in full, as a two-column list separated by
            hairlines: denser, faster to scan, and the content is unchanged. */}
        <section aria-labelledby="caps-heading" className="px-4 sm:px-6 lg:px-8 py-16 sm:py-20 border-t border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-surface-darkCard/30">
          <div className="max-w-6xl mx-auto">
            <div className="max-w-2xl space-y-3">
              <h2 id="caps-heading" className="text-3xl font-medium tracking-tight text-slate-900 dark:text-white">
                What the platform does today
              </h2>
              <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                Everything listed here is implemented and in use — not a roadmap.
              </p>
            </div>

            <dl className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-10">
              {CAPABILITIES.map((c) => (
                <div
                  key={c.title}
                  className="flex gap-4 py-5 border-b border-slate-200/70 dark:border-slate-800/70"
                >
                  <span className="flex-shrink-0 text-slate-400 dark:text-slate-500 pt-0.5" aria-hidden="true">
                    {c.icon}
                  </span>
                  <div className="min-w-0">
                    <dt className="text-sm text-slate-900 dark:text-white">{c.title}</dt>
                    <dd className="text-xs leading-relaxed text-slate-500 dark:text-slate-400 mt-1">{c.body}</dd>
                  </div>
                </div>
              ))}
            </dl>
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
