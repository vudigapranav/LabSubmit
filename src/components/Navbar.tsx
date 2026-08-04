'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useApp } from '@/context/AppContext';
import { Sun, Moon, LogOut, User as UserIcon, Shield, GraduationCap, School } from 'lucide-react';

interface NavbarProps {
  onOpenProfile?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenProfile }) => {
  const { user, theme, toggleTheme, logout } = useApp();
  const [logoError, setLogoError] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200 dark:border-slate-800/80 bg-white/95 dark:bg-surface-darkCard/95 backdrop-blur transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Official CBIT Branding */}
        <Link href="/" className="flex items-center space-x-3 group">
          <div className="relative w-10 h-10 flex items-center justify-center overflow-hidden">
            {!logoError ? (
              <Image
                src="/cbit-logo.png"
                alt="CBIT Logo"
                width={40}
                height={40}
                className="object-contain w-auto h-10"
                onError={() => setLogoError(true)}
                priority
              />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-brand-olive-700 text-white flex items-center justify-center font-bold text-xs">
                CBIT
              </div>
            )}
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-base tracking-tight text-slate-900 dark:text-slate-100 group-hover:text-brand-olive-700 dark:group-hover:text-brand-olive-500 transition-colors">
              Chaitanya Bharathi Institute of Technology
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-normal">
              Programming Laboratory Platform
            </span>
          </div>
        </Link>

        {/* Right Controls */}
        <div className="flex items-center space-x-3">
          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 bg-slate-100 dark:bg-slate-800/60 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
            title={`Switch to ${theme === 'light' ? 'Dark Mode' : 'Light Mode'}`}
          >
            {theme === 'light' ? (
              <Moon className="w-4 h-4 text-slate-700" />
            ) : (
              <Sun className="w-4 h-4 text-amber-400" />
            )}
          </button>

          {user && (
            <div className="flex items-center space-x-3 pl-3 border-l border-slate-200 dark:border-slate-800">
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-xs font-semibold text-slate-900 dark:text-slate-200">
                  {user.name}
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono flex items-center space-x-1">
                  {user.role === 'ADMIN' && <Shield className="w-3 h-3 text-red-600" />}
                  {user.role === 'LECTURER' && <School className="w-3 h-3 text-brand-blue-600" />}
                  {user.role === 'STUDENT' && <GraduationCap className="w-3 h-3 text-brand-olive-600" />}
                  <span>{user.role === 'STUDENT' ? user.rollNumber : user.role}</span>
                </span>
              </div>

              {onOpenProfile && (
                <button
                  onClick={onOpenProfile}
                  className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  title="Profile & Settings"
                >
                  <UserIcon className="w-4 h-4" />
                </button>
              )}

              <button
                onClick={logout}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center space-x-1"
                title="Logout"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
