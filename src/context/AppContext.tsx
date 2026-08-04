'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

export interface User {
  id: string;
  name: string;
  email?: string | null;
  rollNumber?: string | null;
  role: 'ADMIN' | 'LECTURER' | 'STUDENT';
  theme?: string;
  lecturerProfile?: any;
  studentProfile?: any;
}

interface AppContextType {
  user: User | null;
  token: string | null;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  login: (token: string, user: User) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
  loading: boolean;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [theme, setThemeState] = useState<'light' | 'dark'>('light');
  const [loading, setLoading] = useState<boolean>(true);

  // Initialize theme and token on client
  useEffect(() => {
    const savedToken = localStorage.getItem('cbit_token');
    const savedTheme = localStorage.getItem('cbit_theme') as 'light' | 'dark' | null;

    if (savedTheme) {
      setThemeState(savedTheme);
      applyTheme(savedTheme);
    } else {
      applyTheme('light');
    }

    if (savedToken) {
      setToken(savedToken);
      fetchUserSession(savedToken);
    } else {
      setLoading(false);
    }
  }, []);

  const applyTheme = (newTheme: 'light' | 'dark') => {
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const setTheme = (newTheme: 'light' | 'dark') => {
    setThemeState(newTheme);
    localStorage.setItem('cbit_theme', newTheme);
    applyTheme(newTheme);

    // Persist theme to database if user is logged in
    if (token) {
      fetch('/api/profile/theme', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ theme: newTheme }),
      }).catch(() => {});
    }
  };

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  const fetchUserSession = async (authToken: string) => {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        if (data.user.theme && (data.user.theme === 'light' || data.user.theme === 'dark')) {
          setThemeState(data.user.theme);
          applyTheme(data.user.theme);
          localStorage.setItem('cbit_theme', data.user.theme);
        }
      } else {
        logout();
      }
    } catch (e) {
      console.error('Failed to fetch session:', e);
    } finally {
      setLoading(false);
    }
  };

  const login = (authToken: string, userData: User) => {
    setToken(authToken);
    setUser(userData);
    localStorage.setItem('cbit_token', authToken);
    if (userData.theme && (userData.theme === 'light' || userData.theme === 'dark')) {
      setTheme(userData.theme);
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('cbit_token');
  };

  const refreshUser = async () => {
    if (token) {
      await fetchUserSession(token);
    }
  };

  return (
    <AppContext.Provider
      value={{
        user,
        token,
        theme,
        setTheme,
        toggleTheme,
        login,
        logout,
        refreshUser,
        loading,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
