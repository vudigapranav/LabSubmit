import React from 'react';

/**
 * The hero's product view: the student examination surface, at rest, mid-attempt.
 *
 * It is built in code rather than generated, because the thing worth showing is the thing
 * the product actually produces — the structured lab record on one side, a real terminal on
 * the other. That pairing is the whole argument of the page, and a stock illustration or an
 * empty mockup frame would make it instead of making it.
 *
 * It is dark because the real examination surface is dark (see CLAUDE.md §7: the live exam
 * keeps the tokens but not the chrome, deliberately distraction-free). So this is the one
 * bright, detailed object on an otherwise quiet page, and it is honest about what a student
 * sees.
 *
 * The content is plausible rather than placeholder: a real C program for a real question,
 * output that program would actually print, and an aim written the way a student writes one.
 */
export const LandingPreview: React.FC = () => (
  <div
    aria-hidden="true"
    className="select-none rounded-[14px] border border-slate-800 bg-[#0d1117] shadow-overlay overflow-hidden"
  >
    {/* Attempt bar — the exam, the paper, the clock */}
    <div className="flex items-center justify-between gap-3 px-4 h-11 border-b border-slate-800 bg-[#11161f]">
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-mono text-[11px] text-slate-400">CS202L</span>
        <span className="text-slate-700">/</span>
        <span className="text-[12px] text-slate-200 truncate">Exam 1: Java Classes, Objects &amp; Methods</span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-brand-olive-400" />
        <span className="font-mono text-[11px] text-brand-olive-300 tabular">38:14</span>
      </div>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.1fr]">
      {/* The lab record — the half that is not an editor */}
      <div className="p-4 space-y-3 border-b sm:border-b-0 sm:border-r border-slate-800">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-slate-500">01</span>
          <span className="text-[11px] text-slate-300">Aim</span>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">
          To implement a Java class that models a bank account and demonstrate object
          creation, field encapsulation and instance methods.
        </p>

        <div className="flex items-center gap-2 pt-1">
          <span className="font-mono text-[10px] text-slate-500">02</span>
          <span className="text-[11px] text-slate-300">Algorithm</span>
        </div>
        <ol className="space-y-1 text-[11px] leading-relaxed text-slate-400">
          <li>1. Declare the class with private balance and holder fields</li>
          <li>2. Add a constructor that sets the opening balance</li>
          <li>3. Add deposit and withdraw, rejecting an overdraft</li>
        </ol>

        <div className="flex items-center gap-2 pt-1">
          <span className="font-mono text-[10px] text-slate-500">03</span>
          <span className="text-[11px] text-slate-300">Code</span>
          <span className="font-mono text-[10px] text-slate-600">from the editor</span>
        </div>
      </div>

      {/* The editor and the terminal under it */}
      <div className="bg-[#0b0f16]">
        <div className="px-4 pt-3 pb-2 font-mono text-[11px] leading-[1.7]">
          <div className="text-slate-600">
            <span className="inline-block w-5 text-right mr-3">7</span>
            <span className="text-slate-400">public void </span>
            <span className="text-brand-blue-300">withdraw</span>
            <span className="text-slate-400">(double amt) {'{'}</span>
          </div>
          <div className="text-slate-600">
            <span className="inline-block w-5 text-right mr-3">8</span>
            <span className="text-slate-400">  if (amt &gt; balance) {'{'}</span>
          </div>
          <div className="text-slate-600">
            <span className="inline-block w-5 text-right mr-3">9</span>
            <span className="text-slate-400">    System.out.println(</span>
            <span className="text-brand-olive-300">&quot;Insufficient funds&quot;</span>
            <span className="text-slate-400">);</span>
          </div>
          <div className="text-slate-600">
            <span className="inline-block w-5 text-right mr-3">10</span>
            <span className="text-slate-400">    return;</span>
          </div>
          <div className="text-slate-600">
            <span className="inline-block w-5 text-right mr-3">11</span>
            <span className="text-slate-400">  {'}'}</span>
          </div>
        </div>

        <div className="border-t border-slate-800 px-4 py-3 font-mono text-[11px] leading-[1.7]">
          <div className="text-slate-500">$ javac Account.java &amp;&amp; java Account</div>
          <div className="text-slate-300">Opening balance: 5000.00</div>
          <div className="text-slate-300">Insufficient funds</div>
          <div className="text-slate-300">Closing balance: 4250.00</div>
          <div className="text-slate-600">
            <span className="inline-block w-1.5 h-3 align-middle bg-slate-600" />
          </div>
        </div>
      </div>
    </div>
  </div>
);
