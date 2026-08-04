'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { Navbar } from '@/components/Navbar';
import { ArrowRight, AlertCircle, CheckCircle2, School } from 'lucide-react';

export default function RegisterPage() {
  const router = useRouter();
  const { login } = useApp();

  const [name, setName] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [year, setYear] = useState('1');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [logoError, setLogoError] = useState(false);

  // Success modal state
  const [registrationSuccess, setRegistrationSuccess] = useState<{
    detectedBranchName: string;
    year: number;
    token: string;
    user: any;
  } | null>(null);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const trimmedRoll = rollNumber.trim();
    const rollRegex = /^1601\d{8}$/;
    if (!rollRegex.test(trimmedRoll)) {
      setErrorMsg('Roll Number must be exactly 12 digits starting with 1601.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/register-student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          rollNumber: trimmedRoll,
          year,
          password,
        }),
      });

      const data = await res.json();
      setLoading(false);

      if (res.ok) {
        setRegistrationSuccess({
          detectedBranchName: data.detectedBranchName,
          year: data.year,
          token: data.token,
          user: data.user,
        });
      } else {
        setErrorMsg(data.error || 'Registration failed.');
      }
    } catch (err: any) {
      setLoading(false);
      setErrorMsg('Network error. Failed to complete registration.');
    }
  };

  const handleProceedToDashboard = () => {
    if (registrationSuccess) {
      login(registrationSuccess.token, registrationSuccess.user);
      router.push('/student');
    }
  };

  return (
    <div className="min-h-screen bg-surface-lightBg dark:bg-surface-darkBg flex flex-col transition-colors">
      <Navbar />

      <main className="flex-1 flex items-center justify-center p-4 py-16">
        <div className="max-w-lg w-full bg-white dark:bg-surface-darkCard p-8 rounded-2xl border border-slate-200 dark:border-slate-800/80 shadow-sm space-y-6">
          {/* Header */}
          <div className="text-center space-y-3">
            <div className="flex justify-center">
              {!logoError ? (
                <Image
                  src="/cbit-logo.png"
                  alt="CBIT Logo"
                  width={64}
                  height={64}
                  className="object-contain w-auto h-14"
                  onError={() => setLogoError(true)}
                  priority
                />
              ) : (
                <div className="w-14 h-14 rounded-xl bg-brand-olive-700 text-white flex items-center justify-center font-bold text-lg">
                  CBIT
                </div>
              )}
            </div>

            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                Student Self Registration
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Chaitanya Bharathi Institute of Technology
              </p>
            </div>
          </div>

          {/* Registration Success Modal Card */}
          {registrationSuccess ? (
            <div className="p-6 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded-2xl space-y-4">
              <div className="flex items-center space-x-3 text-emerald-800 dark:text-emerald-200">
                <CheckCircle2 className="w-6 h-6 text-emerald-500 flex-shrink-0" />
                <div>
                  <h3 className="font-bold text-sm">Registration Successful!</h3>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    Your account has been created and verified.
                  </p>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-emerald-100 dark:border-emerald-900/50 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400 font-medium">Academic Year:</span>
                  <span className="font-bold text-slate-900 dark:text-white">Year {registrationSuccess.year}</span>
                </div>
                <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-2">
                  <span className="text-slate-500 dark:text-slate-400 font-medium">Auto-Detected Branch:</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800">
                    {registrationSuccess.detectedBranchName}
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-slate-500 dark:text-slate-400 italic text-center">
                Branch automatically assigned based on your roll number range.
              </p>

              <button
                onClick={handleProceedToDashboard}
                className="w-full py-3 rounded-xl bg-brand-olive-700 hover:bg-brand-olive-800 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center space-x-2"
              >
                <span>Proceed to Student Dashboard</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
              {/* Error Notice */}
              {errorMsg && (
                <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl text-red-700 dark:text-red-300 text-xs font-medium flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <form onSubmit={handleRegister} className="space-y-4" autoComplete="off">
                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    placeholder="Full Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="off"
                    className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-brand-olive-600 focus:ring-1 focus:ring-brand-olive-600"
                    required
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Roll Number (1601XXXXXXXX)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 160125733001"
                    value={rollNumber}
                    onChange={(e) => setRollNumber(e.target.value)}
                    autoComplete="off"
                    className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-brand-olive-600 focus:ring-1 focus:ring-brand-olive-600 font-mono"
                    required
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    Branch will be automatically allocated based on your roll number range.
                  </p>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Academic Year
                  </label>
                  <select
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-brand-olive-600 focus:ring-1 focus:ring-brand-olive-600"
                    required
                  >
                    <option value="1">1st Year</option>
                    <option value="2">2nd Year</option>
                    <option value="3">3rd Year</option>
                    <option value="4">4th Year</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">
                      Create Password
                    </label>
                    <input
                      type="password"
                      placeholder="Password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-brand-olive-600 focus:ring-1 focus:ring-brand-olive-600"
                      required
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">
                      Confirm Password
                    </label>
                    <input
                      type="password"
                      placeholder="Confirm"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-brand-olive-600 focus:ring-1 focus:ring-brand-olive-600"
                      required
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-2 py-3 rounded-xl bg-brand-olive-700 hover:bg-brand-olive-800 disabled:opacity-50 text-white font-semibold text-sm transition-all shadow-md flex items-center justify-center space-x-2"
                >
                  <span>{loading ? 'Detecting Branch & Registering...' : 'Complete Student Registration'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            </>
          )}

          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 text-center">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Already have an active student account?{' '}
              <Link href="/login" className="text-brand-blue-600 dark:text-brand-blue-400 font-bold hover:underline">
                Sign In
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
