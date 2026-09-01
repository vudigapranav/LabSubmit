'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { Navbar } from '@/components/Navbar';
import { Shield, GraduationCap, ArrowRight, User as UserIcon, Lock, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useApp();

  const [activeTab, setActiveTab] = useState<'STUDENT' | 'FACULTY'>('STUDENT');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [logoError, setLogoError] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!identifier || !password) {
      setErrorMsg('Please enter your credentials');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: identifier.trim(),
          password,
          role: activeTab,
        }),
      });

      const data = await res.json();
      setLoading(false);

      if (res.ok) {
        login(data.token, data.user);
        if (data.user.role === 'ADMIN') {
          router.push('/admin');
        } else if (data.user.role === 'LECTURER') {
          router.push('/lecturer');
        } else {
          router.push('/student');
        }
      } else {
        setErrorMsg(data.error || 'Invalid credentials or user not found');
      }
    } catch (err: any) {
      setLoading(false);
      setErrorMsg('Unable to connect to server. Please check your network connection.');
    }
  };

  return (
    <div className="min-h-screen bg-surface-lightBg dark:bg-surface-darkBg flex flex-col transition-colors">
      <Navbar />

      <main className="flex-1 flex items-center justify-center px-3 py-8 sm:p-4 sm:py-16">
        <div className="max-w-md w-full bg-white dark:bg-surface-darkCard p-5 sm:p-8 rounded-2xl border border-slate-200 dark:border-slate-800/80 shadow-sm space-y-5 sm:space-y-6">
          {/* Official College Header & Logo */}
          <div className="text-center space-y-3">
            <div className="flex justify-center">
              {!logoError ? (
                <Image
                  src="/cbit-logo.png"
                  alt="Chaitanya Bharathi Institute of Technology Logo"
                  width={72}
                  height={72}
                  className="object-contain w-auto h-16"
                  onError={() => setLogoError(true)}
                  priority
                />
              ) : (
                <div className="w-16 h-16 rounded-xl bg-brand-olive-700 text-white flex items-center justify-center font-bold text-xl">
                  CBIT
                </div>
              )}
            </div>

            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                Chaitanya Bharathi Institute of Technology
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Programming Laboratory Management Portal
              </p>
            </div>
          </div>

          {/* 2 Role Tabs: Student Login vs Faculty Login */}
          <div className="grid grid-cols-2 gap-1 bg-slate-100 dark:bg-slate-800/60 p-1 rounded-xl border border-slate-200/60 dark:border-slate-700/50">
            <button
              type="button"
              onClick={() => {
                setActiveTab('STUDENT');
                setErrorMsg(null);
              }}
              className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center space-x-2 ${
                activeTab === 'STUDENT'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <GraduationCap className="w-4 h-4" />
              <span>Student Login</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('FACULTY');
                setErrorMsg(null);
              }}
              className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center space-x-2 ${
                activeTab === 'FACULTY'
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Shield className="w-4 h-4" />
              <span>Faculty Login</span>
            </button>
          </div>

          {/* Error Notice */}
          {errorMsg && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl text-red-700 dark:text-red-300 text-xs font-medium flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleLogin} className="space-y-4" autoComplete="off">
            <div>
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">
                {activeTab === 'STUDENT' ? 'Roll Number or Registered Email' : 'Faculty / Staff Email'}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <UserIcon className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  placeholder={
                    activeTab === 'STUDENT' ? 'e.g. 160125733001 or student@cbit.in' : 'e.g. ravi@cbit.in or admin@cbit.in'
                  }
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  autoComplete="off"
                  className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl pl-9 pr-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-brand-olive-600 focus:ring-1 focus:ring-brand-olive-600"
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl pl-9 pr-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-brand-olive-600 focus:ring-1 focus:ring-brand-olive-600"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className={`w-full py-3 rounded-xl font-semibold text-sm transition-all shadow-md flex items-center justify-center space-x-2 ${
                activeTab === 'STUDENT'
                  ? 'bg-brand-olive-700 hover:bg-brand-olive-800 text-white'
                  : 'bg-slate-900 dark:bg-slate-100 hover:opacity-90 text-white dark:text-slate-900'
              } disabled:opacity-50`}
            >
              <span>{loading ? 'Authenticating...' : activeTab === 'STUDENT' ? 'Sign In as Student' : 'Sign In as Faculty'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Footer Note */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 text-center space-y-2">
            {activeTab === 'STUDENT' ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                First time student user?{' '}
                <Link href="/register" className="text-brand-blue-600 dark:text-brand-blue-400 font-bold hover:underline">
                  Self Register Account
                </Link>
              </p>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Faculty accounts are provisioned by the Department Administrator.
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
