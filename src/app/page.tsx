'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { Navbar } from '@/components/Navbar';
import { GraduationCap, ArrowRight } from 'lucide-react';

export default function Home() {
  const router = useRouter();
  const { user, loading } = useApp();
  const [logoError, setLogoError] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      if (user.role === 'ADMIN') router.push('/admin');
      else if (user.role === 'LECTURER') router.push('/lecturer');
      else if (user.role === 'STUDENT') router.push('/student');
    }
  }, [user, loading, router]);

  return (
    <div className="min-h-screen bg-surface-lightBg dark:bg-surface-darkBg flex flex-col transition-colors">
      <Navbar />

      <main className="flex-1 flex flex-col justify-center items-center max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center space-y-8">
        {/* Official CBIT Logo */}
        <div className="flex justify-center">
          {!logoError ? (
            <Image
              src="/cbit-logo.png"
              alt="Chaitanya Bharathi Institute of Technology"
              width={80}
              height={80}
              className="object-contain w-auto h-20"
              onError={() => setLogoError(true)}
              priority
            />
          ) : (
            <div className="w-16 h-16 rounded-control bg-brand-olive-700 text-white flex items-center justify-center font-bold text-xl">
              CBIT
            </div>
          )}
        </div>

        {/* Institution Name & Main Product Title */}
        <div className="space-y-3">
          <p className="text-xs sm:text-sm font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Chaitanya Bharathi Institute of Technology
          </p>
          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            LabSubmit
          </h1>
          <p className="text-base sm:text-lg font-medium text-brand-olive-700 dark:text-brand-olive-400">
            Programming Laboratory Management & Code Execution Portal
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
          <Link
            href="/login"
            className="w-full sm:w-auto px-8 py-3.5 rounded-control bg-brand-olive-700 hover:bg-brand-olive-800 dark:bg-brand-olive-700 dark:hover:bg-brand-olive-600 text-white font-semibold text-sm transition-colors flex items-center justify-center space-x-2 shadow-card"
          >
            <span>Access Portal Login</span>
            <ArrowRight className="w-4 h-4" />
          </Link>

          <Link
            href="/register"
            className="w-full sm:w-auto px-8 py-3.5 rounded-control bg-white dark:bg-slate-800 text-brand-blue-600 dark:text-brand-blue-400 hover:bg-slate-50 dark:hover:bg-slate-700/60 border border-slate-200 dark:border-slate-700 font-semibold text-sm transition-colors flex items-center justify-center space-x-2 shadow-card"
          >
            <GraduationCap className="w-4 h-4" />
            <span>Student Registration</span>
          </Link>
        </div>
      </main>

      <footer className="py-6 border-t border-slate-200 dark:border-slate-800 text-center text-xs text-slate-400 dark:text-slate-500">
        &copy; {new Date().getFullYear()} Chaitanya Bharathi Institute of Technology. All Rights Reserved.
      </footer>
    </div>
  );
}
