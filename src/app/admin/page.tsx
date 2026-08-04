'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { Navbar } from '@/components/Navbar';
import { ProfileModal } from '@/components/ProfileModal';
import {
  Shield,
  UserPlus,
  BookOpen,
  Key,
  Trash2,
  Edit2,
  Eye,
  Plus,
  BarChart3,
  GraduationCap,
  School,
  CheckCircle,
  AlertCircle,
  Filter,
} from 'lucide-react';

export default function AdminDashboard() {
  const router = useRouter();
  const { user, token, loading } = useApp();

  const [activeTab, setActiveTab] = useState<'branches' | 'subjects' | 'lecturers' | 'students' | 'labs' | 'reports'>('branches');
  const [profileOpen, setProfileOpen] = useState(false);

  // Data states
  const [branches, setBranches] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [lecturers, setLecturers] = useState<any[]>([]);
  const [labs, setLabs] = useState<any[]>([]);

  // Student Filtering States (Academic Year -> Branch -> Students)
  const [studentFilterYear, setStudentFilterYear] = useState<string>('');
  const [studentFilterBranchId, setStudentFilterBranchId] = useState<string>('');
  const [studentFilterBranches, setStudentFilterBranches] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);

  // Filters for Lab Management
  const [filterYear, setFilterYear] = useState<string>('');
  const [filterBranchId, setFilterBranchId] = useState<string>('');
  const [filterSubjectId, setFilterSubjectId] = useState<string>('');

  // Modals visibility
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [showSubjectModal, setShowSubjectModal] = useState(false);
  const [showAddLecturerModal, setShowAddLecturerModal] = useState(false);
  const [showViewUserModal, setShowViewUserModal] = useState(false);
  const [showEditStudentModal, setShowEditStudentModal] = useState(false);
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);

  // Form fields: Branch
  const [branchName, setBranchName] = useState('');
  const [branchYear, setBranchYear] = useState('1');
  const [rollStart, setRollStart] = useState('');
  const [rollEnd, setRollEnd] = useState('');
  const [editingBranchId, setEditingBranchId] = useState<string | null>(null);

  // Form fields: Subject
  const [subName, setSubName] = useState('');
  const [subCode, setSubCode] = useState('');
  const [subSemester, setSubSemester] = useState('1');
  const [subYear, setSubYear] = useState('1');
  const [subBranchId, setSubBranchId] = useState('');
  const [subLecturerId, setSubLecturerId] = useState('');
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);

  // Form fields: Lecturer
  const [lecName, setLecName] = useState('');
  const [lecEmail, setLecEmail] = useState('');
  const [lecPassword, setLecPassword] = useState('');
  const [lecDepartment, setLecDepartment] = useState('Computer Science & Engineering');
  const [lecPhone, setLecPhone] = useState('');
  const [editingLecturerId, setEditingLecturerId] = useState<string | null>(null);

  // Form fields: Student Edit
  const [editingStudent, setEditingStudent] = useState<any | null>(null);
  const [editStudentName, setEditStudentName] = useState('');
  const [editStudentEmail, setEditStudentEmail] = useState('');
  const [editStudentRoll, setEditStudentRoll] = useState('');
  const [editStudentYear, setEditStudentYear] = useState('1');
  const [editStudentBranchId, setEditStudentBranchId] = useState('');

  // Password Reset Target
  const [targetResetUser, setTargetResetUser] = useState<{ id: string; name: string; role: 'STUDENT' | 'LECTURER' } | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');

  // View User Target
  const [viewingUser, setViewingUser] = useState<any | null>(null);

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'ADMIN')) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (token) {
      fetchBranches();
      fetchSubjects();
      fetchLecturers();
      fetchLabs();
    }
  }, [token]);

  // Handle dynamic branch loading when studentFilterYear changes
  useEffect(() => {
    if (token && studentFilterYear) {
      fetchStudentFilterBranches(studentFilterYear);
    } else {
      setStudentFilterBranches([]);
      setStudentFilterBranchId('');
      setStudents([]);
    }
  }, [token, studentFilterYear]);

  // Handle student loading when both year and branchId are selected
  useEffect(() => {
    if (token && studentFilterYear && studentFilterBranchId) {
      fetchFilteredStudents(studentFilterYear, studentFilterBranchId);
    } else {
      setStudents([]);
    }
  }, [token, studentFilterYear, studentFilterBranchId]);

  const showToast = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  const fetchBranches = async () => {
    try {
      const res = await fetch('/api/admin/branches', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setBranches(data.branches || []);
        if (data.branches.length > 0 && !subBranchId) {
          setSubBranchId(data.branches[0].id);
        }
      }
    } catch (e) { console.error(e); }
  };

  const fetchStudentFilterBranches = async (year: string) => {
    try {
      const res = await fetch(`/api/admin/branches?year=${year}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setStudentFilterBranches(data.branches || []);
      }
    } catch (e) { console.error(e); }
  };

  const fetchFilteredStudents = async (year: string, branchId: string) => {
    setLoadingStudents(true);
    try {
      const res = await fetch(`/api/admin/students?year=${year}&branchId=${branchId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setStudents(data.students || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingStudents(false);
    }
  };

  const fetchSubjects = async () => {
    try {
      const res = await fetch('/api/admin/subjects', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setSubjects(data.subjects || []);
      }
    } catch (e) { console.error(e); }
  };

  const fetchLecturers = async () => {
    try {
      const res = await fetch('/api/admin/lecturers', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setLecturers(data.lecturers || []);
        if (data.lecturers.length > 0 && !subLecturerId) {
          setSubLecturerId(data.lecturers[0].id);
        }
      }
    } catch (e) { console.error(e); }
  };

  const fetchLabs = async () => {
    try {
      const query = new URLSearchParams();
      if (filterYear) query.set('year', filterYear);
      if (filterBranchId) query.set('branchId', filterBranchId);
      if (filterSubjectId) query.set('subjectId', filterSubjectId);

      const res = await fetch(`/api/lecturer/labs?${query.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setLabs(data.labs || []);
      }
    } catch (e) { console.error(e); }
  };

  // Branch Operations
  const handleSaveBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    const endpoint = '/api/admin/branches';
    const method = editingBranchId ? 'PUT' : 'POST';

    try {
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          id: editingBranchId,
          name: branchName,
          year: branchYear,
          rollStart,
          rollEnd,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('success', editingBranchId ? 'Branch updated' : 'Branch created');
        setShowBranchModal(false);
        setEditingBranchId(null);
        setBranchName('');
        setRollStart('');
        setRollEnd('');
        fetchBranches();
        if (studentFilterYear) fetchStudentFilterBranches(studentFilterYear);
      } else {
        showToast('error', data.error || 'Failed to save branch');
      }
    } catch (e) { showToast('error', 'Server error'); }
  };

  const handleDeleteBranch = async (id: string) => {
    if (!confirm('Are you sure you want to delete this branch?')) return;
    try {
      const res = await fetch(`/api/admin/branches?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        showToast('success', 'Branch deleted');
        fetchBranches();
        if (studentFilterYear) fetchStudentFilterBranches(studentFilterYear);
      }
    } catch (e) { showToast('error', 'Server error'); }
  };

  // Subject Operations
  const handleSaveSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    const endpoint = '/api/admin/subjects';
    const method = editingSubjectId ? 'PUT' : 'POST';

    try {
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          id: editingSubjectId,
          name: subName,
          code: subCode,
          semester: subSemester,
          year: subYear,
          branchId: subBranchId,
          lecturerId: subLecturerId,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('success', editingSubjectId ? 'Subject updated' : 'Subject created');
        setShowSubjectModal(false);
        setEditingSubjectId(null);
        setSubName('');
        setSubCode('');
        fetchSubjects();
      } else {
        showToast('error', data.error || 'Failed to save subject');
      }
    } catch (e) { showToast('error', 'Server error'); }
  };

  const handleDeleteSubject = async (id: string) => {
    if (!confirm('Are you sure you want to delete this subject?')) return;
    try {
      const res = await fetch(`/api/admin/subjects?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        showToast('success', 'Subject deleted');
        fetchSubjects();
      }
    } catch (e) { showToast('error', 'Server error'); }
  };

  // Lecturer Operations
  const handleSaveLecturer = async (e: React.FormEvent) => {
    e.preventDefault();
    const endpoint = '/api/admin/lecturers';
    const method = editingLecturerId ? 'PUT' : 'POST';

    try {
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          id: editingLecturerId,
          name: lecName,
          email: lecEmail,
          password: lecPassword,
          department: lecDepartment,
          phone: lecPhone,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('success', editingLecturerId ? 'Lecturer updated' : 'Lecturer created');
        setShowAddLecturerModal(false);
        setEditingLecturerId(null);
        setLecName('');
        setLecEmail('');
        setLecPassword('');
        setLecPhone('');
        fetchLecturers();
      } else {
        showToast('error', data.error || 'Failed to save lecturer');
      }
    } catch (e) { showToast('error', 'Server error'); }
  };

  const handleDeleteLecturer = async (id: string) => {
    if (!confirm('Are you sure you want to delete this lecturer account?')) return;
    try {
      const res = await fetch(`/api/admin/lecturers?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        showToast('success', 'Lecturer account deleted');
        fetchLecturers();
      } else {
        const data = await res.json();
        showToast('error', data.error || 'Failed to delete lecturer');
      }
    } catch (e) { showToast('error', 'Server error'); }
  };

  // Student Manual Branch Override
  const handleSaveEditStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStudent) return;

    try {
      const res = await fetch('/api/admin/students', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          userId: editingStudent.userId,
          name: editStudentName,
          email: editStudentEmail,
          rollNumber: editStudentRoll,
          year: editStudentYear,
          branchId: editStudentBranchId,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('success', 'Student details updated successfully');
        setShowEditStudentModal(false);
        setEditingStudent(null);
        if (studentFilterYear && studentFilterBranchId) {
          fetchFilteredStudents(studentFilterYear, studentFilterBranchId);
        }
      } else {
        showToast('error', data.error || 'Failed to update student');
      }
    } catch (e) { showToast('error', 'Server error'); }
  };

  const handleDeleteStudent = async (studentUserId: string, name: string) => {
    if (!confirm(`Are you sure you want to delete student account for ${name}?`)) return;
    try {
      const res = await fetch(`/api/admin/students?id=${studentUserId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        showToast('success', 'Student account deleted');
        if (studentFilterYear && studentFilterBranchId) {
          fetchFilteredStudents(studentFilterYear, studentFilterBranchId);
        }
      } else {
        const data = await res.json();
        showToast('error', data.error || 'Failed to delete student');
      }
    } catch (e) { showToast('error', 'Server error'); }
  };

  // Password Reset Operation (Student & Lecturer)
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetResetUser || !newPasswordInput) return;

    const endpoint = targetResetUser.role === 'STUDENT'
      ? '/api/admin/students/reset-password'
      : '/api/admin/lecturers/reset-password';

    const payload = targetResetUser.role === 'STUDENT'
      ? { userId: targetResetUser.id, newPassword: newPasswordInput }
      : { lecturerId: targetResetUser.id, newPassword: newPasswordInput };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('success', data.message || `Password for ${targetResetUser.name} reset successfully`);
        setShowResetPasswordModal(false);
        setTargetResetUser(null);
        setNewPasswordInput('');
      } else {
        showToast('error', data.error || 'Failed to reset password');
      }
    } catch (e) { showToast('error', 'Server error'); }
  };

  if (loading || !user) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white font-mono text-xs">Loading Admin Control Center...</div>;
  }

  return (
    <div className="min-h-screen bg-surface-lightBg dark:bg-surface-darkBg flex flex-col transition-colors">
      <Navbar onOpenProfile={() => setProfileOpen(true)} />

      {/* Toast Notification */}
      {notification && (
        <div
          className={`fixed top-16 right-4 z-50 px-4 py-3 rounded-xl shadow-xl border text-xs font-semibold flex items-center space-x-2 animate-bounce ${
            notification.type === 'success'
              ? 'bg-emerald-900/90 border-emerald-700 text-emerald-100'
              : 'bg-rose-900/90 border-rose-700 text-rose-100'
          }`}
        >
          {notification.type === 'success' ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <AlertCircle className="w-4 h-4 text-rose-400" />}
          <span>{notification.message}</span>
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Header */}
        <div className="bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-slate-800/80 rounded-2xl p-6 sm:p-8 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <Shield className="w-5 h-5 text-brand-blue-600 dark:text-brand-blue-400" />
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Admin Control Center</h1>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
              Academic Hierarchy & College System Governance
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                setEditingBranchId(null);
                setBranchName('');
                setRollStart('');
                setRollEnd('');
                setShowBranchModal(true);
              }}
              className="px-3.5 py-2 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold hover:opacity-90 transition-all shadow-sm flex items-center space-x-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Branch</span>
            </button>
            <button
              onClick={() => {
                setEditingSubjectId(null);
                setSubName('');
                setSubCode('');
                setShowSubjectModal(true);
              }}
              className="px-3.5 py-2 rounded-xl bg-brand-olive-700 hover:bg-brand-olive-800 text-white text-xs font-semibold transition-all shadow-sm flex items-center space-x-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Subject</span>
            </button>
            <button
              onClick={() => {
                setEditingLecturerId(null);
                setLecName('');
                setLecEmail('');
                setLecPassword('');
                setShowAddLecturerModal(true);
              }}
              className="px-3.5 py-2 rounded-xl bg-brand-blue-600 hover:bg-brand-blue-700 text-white text-xs font-semibold transition-all shadow-sm flex items-center space-x-1.5"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Add Faculty</span>
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center space-x-2 border-b border-slate-200 dark:border-slate-800/80 pb-3 overflow-x-auto">
          <button
            onClick={() => setActiveTab('branches')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center space-x-2 ${
              activeTab === 'branches' ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <School className="w-3.5 h-3.5" />
            <span>Branches ({branches.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('subjects')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center space-x-2 ${
              activeTab === 'subjects' ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Subjects ({subjects.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('lecturers')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center space-x-2 ${
              activeTab === 'lecturers' ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <GraduationCap className="w-3.5 h-3.5" />
            <span>Faculty Lecturers ({lecturers.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('students')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center space-x-2 ${
              activeTab === 'students' ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <GraduationCap className="w-3.5 h-3.5" />
            <span>Student Management</span>
          </button>

          <button
            onClick={() => setActiveTab('labs')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center space-x-2 ${
              activeTab === 'labs' ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>All Labs</span>
          </button>
        </div>

        {/* Tab 1: Branches */}
        {activeTab === 'branches' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {branches.map((b) => (
              <div key={b.id} className="bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <span className="px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-brand-olive-950/40 text-brand-olive-300 border border-brand-olive-800/50">
                    Year {b.year}
                  </span>
                  <div className="flex items-center space-x-1">
                    <button
                      onClick={() => {
                        setEditingBranchId(b.id);
                        setBranchName(b.name);
                        setBranchYear(String(b.year));
                        setRollStart(b.rollStart || '');
                        setRollEnd(b.rollEnd || '');
                        setShowBranchModal(true);
                      }}
                      className="p-1 rounded text-slate-400 hover:text-brand-blue-500"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDeleteBranch(b.id)} className="p-1 rounded text-slate-400 hover:text-red-600">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-white">{b.name}</h3>
                  <p className="text-xs text-slate-500 font-mono mt-1">
                    Configured Roll Range: {b.rollStart || 'N/A'} &rarr; {b.rollEnd || 'N/A'}
                  </p>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-400 border-t border-slate-100 dark:border-slate-800 pt-3">
                  <span>Enrolled Students: <strong>{b._count?.students || 0}</strong></span>
                  <span>Subjects: <strong>{b._count?.subjects || 0}</strong></span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tab 2: Subjects & Lecturer Assignments */}
        {activeTab === 'subjects' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {subjects.map((sub) => (
              <div key={sub.id} className="bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <span className="px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-brand-blue-950/40 text-brand-blue-300 border border-brand-blue-800/50">
                    Year {sub.year} • {sub.branch?.name || 'Branch'}
                  </span>
                  <div className="flex items-center space-x-1">
                    <button
                      onClick={() => {
                        setEditingSubjectId(sub.id);
                        setSubName(sub.name);
                        setSubCode(sub.code);
                        setSubYear(String(sub.year));
                        setSubBranchId(sub.branchId);
                        setSubLecturerId(sub.lecturerId || '');
                        setShowSubjectModal(true);
                      }}
                      className="p-1 rounded text-slate-400 hover:text-brand-blue-500"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDeleteSubject(sub.id)} className="p-1 rounded text-slate-400 hover:text-red-600">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-white">{sub.name}</h3>
                  <p className="text-xs text-slate-500 font-mono">Code: {sub.code} • Sem {sub.semester || 'N/A'}</p>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl text-xs text-slate-700 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/50">
                  <div className="font-semibold text-slate-500 text-[10px] uppercase">Assigned Lecturer:</div>
                  <div className="font-bold text-slate-900 dark:text-white text-xs mt-0.5">
                    {sub.lecturer ? `${sub.lecturer.name} (${sub.lecturer.email})` : '⚠️ Unassigned'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tab 3: Faculty Lecturers Management */}
        {activeTab === 'lecturers' && (
          <div className="bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-slate-800/80 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="p-4">Faculty Member</th>
                    <th className="p-4">Email</th>
                    <th className="p-4">Department</th>
                    <th className="p-4">Assigned Subjects</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {lecturers.map((lec) => (
                    <tr key={lec.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="p-4 font-bold text-slate-900 dark:text-white">{lec.name}</td>
                      <td className="p-4 font-mono text-slate-600 dark:text-slate-300">{lec.email}</td>
                      <td className="p-4 text-slate-600 dark:text-slate-300">{lec.lecturerProfile?.department || 'CSE'}</td>
                      <td className="p-4 text-slate-600 dark:text-slate-300">
                        {lec.assignedSubjects && lec.assignedSubjects.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {lec.assignedSubjects.map((s: any) => (
                              <span key={s.id} className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-mono">
                                {s.name} ({s.branch?.name})
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">None</span>
                        )}
                      </td>
                      <td className="p-4 text-right space-x-1.5">
                        <button
                          onClick={() => {
                            setViewingUser({ ...lec, type: 'LECTURER' });
                            setShowViewUserModal(true);
                          }}
                          className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 font-semibold inline-flex items-center space-x-1"
                        >
                          <Eye className="w-3 h-3" />
                          <span>View</span>
                        </button>

                        <button
                          onClick={() => {
                            setEditingLecturerId(lec.id);
                            setLecName(lec.name);
                            setLecEmail(lec.email || '');
                            setLecDepartment(lec.lecturerProfile?.department || 'CSE');
                            setLecPhone(lec.lecturerProfile?.phone || '');
                            setShowAddLecturerModal(true);
                          }}
                          className="px-2 py-1 rounded bg-brand-blue-500/10 text-brand-blue-600 dark:text-brand-blue-400 hover:bg-brand-blue-500/20 font-semibold inline-flex items-center space-x-1"
                        >
                          <Edit2 className="w-3 h-3" />
                          <span>Edit</span>
                        </button>

                        <button
                          onClick={() => {
                            setTargetResetUser({ id: lec.id, name: lec.name, role: 'LECTURER' });
                            setNewPasswordInput('');
                            setShowResetPasswordModal(true);
                          }}
                          className="px-2 py-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 font-semibold inline-flex items-center space-x-1"
                        >
                          <Key className="w-3 h-3" />
                          <span>Reset Pass</span>
                        </button>

                        <button
                          onClick={() => handleDeleteLecturer(lec.id)}
                          className="p-1 rounded text-slate-400 hover:text-red-600 inline-block"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 4: Student Management (Hierarchical Filtering: Academic Year -> Branch -> Students) */}
        {activeTab === 'students' && (
          <div className="space-y-4">
            {/* Hierarchical Filter Bar */}
            <div className="bg-white dark:bg-surface-darkCard p-4 rounded-2xl border border-slate-200 dark:border-slate-800/80 shadow-sm flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="flex items-center space-x-2 text-xs font-bold text-slate-700 dark:text-slate-300">
                <Filter className="w-4 h-4 text-brand-blue-500" />
                <span>Filter Students:</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1 w-full sm:w-auto">
                {/* Step 1: Select Academic Year */}
                <div>
                  <label className="text-[11px] font-semibold text-slate-500 block mb-1">Academic Year</label>
                  <select
                    value={studentFilterYear}
                    onChange={(e) => setStudentFilterYear(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-medium"
                  >
                    <option value="">Select Academic Year ▼</option>
                    <option value="1">1st Year</option>
                    <option value="2">2nd Year</option>
                    <option value="3">3rd Year</option>
                    <option value="4">4th Year</option>
                  </select>
                </div>

                {/* Step 2: Select Branch (Disabled until Academic Year is selected) */}
                <div>
                  <label className="text-[11px] font-semibold text-slate-500 block mb-1">Branch</label>
                  <select
                    value={studentFilterBranchId}
                    onChange={(e) => setStudentFilterBranchId(e.target.value)}
                    disabled={!studentFilterYear}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="">
                      {!studentFilterYear ? 'Select Academic Year first' : 'Select Branch ▼'}
                    </option>
                    {studentFilterBranches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} (Year {b.year})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Display State: Guidance Prompt vs Empty State vs Students Table */}
            {!studentFilterYear || !studentFilterBranchId ? (
              <div className="bg-white dark:bg-surface-darkCard p-12 rounded-2xl border border-slate-200 dark:border-slate-800/80 text-center space-y-2">
                <GraduationCap className="w-10 h-10 text-slate-400 mx-auto" />
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">Hierarchical Student Filtering</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Select an <strong>Academic Year</strong> and <strong>Branch</strong> above to load matching enrolled students from the server.
                </p>
              </div>
            ) : loadingStudents ? (
              <div className="bg-white dark:bg-surface-darkCard p-12 rounded-2xl border border-slate-200 dark:border-slate-800 text-center font-mono text-xs text-slate-400">
                Loading students for Year {studentFilterYear}...
              </div>
            ) : students.length === 0 ? (
              <div className="bg-white dark:bg-surface-darkCard p-12 rounded-2xl border border-slate-200 dark:border-slate-800 text-center space-y-2">
                <AlertCircle className="w-10 h-10 text-amber-500 mx-auto" />
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">No Students Found</h3>
                <p className="text-xs text-slate-500">
                  No students found for the selected Academic Year and Branch.
                </p>
              </div>
            ) : (
              <div className="bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-slate-800/80 rounded-2xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="p-4">Roll Number</th>
                        <th className="p-4">Student Name</th>
                        <th className="p-4">Email</th>
                        <th className="p-4">Branch</th>
                        <th className="p-4">Academic Year</th>
                        <th className="p-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono">
                      {students.map((st) => (
                        <tr key={st.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                          <td className="p-4 font-bold text-slate-900 dark:text-white">{st.rollNumber}</td>
                          <td className="p-4 font-sans font-semibold text-slate-800 dark:text-slate-200">{st.name}</td>
                          <td className="p-4 text-slate-600 dark:text-slate-300 font-sans">{st.email || 'N/A'}</td>
                          <td className="p-4">
                            <span className="px-2 py-0.5 rounded font-mono font-bold bg-emerald-950/40 text-emerald-300 border border-emerald-800/50">
                              {st.branchName}
                            </span>
                          </td>
                          <td className="p-4 text-slate-600 dark:text-slate-300">Year {st.year}</td>
                          <td className="p-4 text-right space-x-1.5">
                            <button
                              onClick={() => {
                                setViewingUser({ ...st, type: 'STUDENT' });
                                setShowViewUserModal(true);
                              }}
                              className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 font-sans font-semibold text-[11px] inline-flex items-center space-x-1"
                            >
                              <Eye className="w-3 h-3" />
                              <span>View</span>
                            </button>

                            <button
                              onClick={() => {
                                setEditingStudent(st);
                                setEditStudentName(st.name);
                                setEditStudentEmail(st.email || '');
                                setEditStudentRoll(st.rollNumber);
                                setEditStudentYear(String(st.year));
                                setEditStudentBranchId(st.branchId || (branches[0] ? branches[0].id : ''));
                                setShowEditStudentModal(true);
                              }}
                              className="px-2 py-1 rounded bg-brand-blue-500/10 text-brand-blue-600 dark:text-brand-blue-400 hover:bg-brand-blue-500/20 font-sans font-semibold text-[11px] inline-flex items-center space-x-1"
                            >
                              <Edit2 className="w-3 h-3" />
                              <span>Edit</span>
                            </button>

                            <button
                              onClick={() => {
                                setTargetResetUser({ id: st.userId, name: st.name, role: 'STUDENT' });
                                setNewPasswordInput('');
                                setShowResetPasswordModal(true);
                              }}
                              className="px-2 py-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 font-sans font-semibold text-[11px] inline-flex items-center space-x-1"
                            >
                              <Key className="w-3 h-3" />
                              <span>Reset Pass</span>
                            </button>

                            <button
                              onClick={() => handleDeleteStudent(st.userId, st.name)}
                              className="p-1 rounded text-slate-400 hover:text-red-600 inline-block"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 5: All Labs Management */}
        {activeTab === 'labs' && (
          <div className="space-y-4">
            <div className="flex items-center space-x-3 bg-white dark:bg-surface-darkCard p-4 rounded-2xl border border-slate-200 dark:border-slate-800/80">
              <Filter className="w-4 h-4 text-slate-400" />
              <select value={filterYear} onChange={(e) => { setFilterYear(e.target.value); fetchLabs(); }} className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-900 dark:text-white">
                <option value="">All Years</option>
                <option value="1">Year 1</option>
                <option value="2">Year 2</option>
                <option value="3">Year 3</option>
                <option value="4">Year 4</option>
              </select>

              <select value={filterBranchId} onChange={(e) => { setFilterBranchId(e.target.value); fetchLabs(); }} className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-900 dark:text-white">
                <option value="">All Branches</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>

              <select value={filterSubjectId} onChange={(e) => { setFilterSubjectId(e.target.value); fetchLabs(); }} className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-900 dark:text-white">
                <option value="">All Subjects</option>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {labs.map((lab) => (
                <div key={lab.id} className="bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      Year {lab.year} • {lab.branch?.name || 'Branch'} • {lab.subject?.name || 'Subject'}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">By {lab.lecturer?.name}</span>
                  </div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">{lab.title}</h3>
                  <p className="text-xs text-slate-500">{lab.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Modal: View User Details */}
      {showViewUserModal && viewingUser && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="font-bold text-base text-slate-900 dark:text-white flex items-center space-x-2">
              <Eye className="w-5 h-5 text-brand-blue-500" />
              <span>{viewingUser.type === 'STUDENT' ? 'Student Profile' : 'Faculty Profile'}</span>
            </h3>

            <div className="space-y-2.5 text-xs bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700/60 font-mono">
              <div className="flex justify-between"><span className="text-slate-500 font-sans">Full Name:</span><strong className="text-slate-900 dark:text-white">{viewingUser.name}</strong></div>
              <div className="flex justify-between"><span className="text-slate-500 font-sans">Email Address:</span><span className="text-slate-800 dark:text-slate-200">{viewingUser.email || 'N/A'}</span></div>
              {viewingUser.type === 'STUDENT' ? (
                <>
                  <div className="flex justify-between"><span className="text-slate-500 font-sans">Roll Number:</span><strong className="text-brand-blue-400">{viewingUser.rollNumber}</strong></div>
                  <div className="flex justify-between"><span className="text-slate-500 font-sans">Academic Year:</span><span>Year {viewingUser.year}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500 font-sans">Auto Branch:</span><strong className="text-emerald-400">{viewingUser.branchName}</strong></div>
                  <div className="flex justify-between"><span className="text-slate-500 font-sans">Submissions:</span><span>{viewingUser.submissionCount || 0}</span></div>
                </>
              ) : (
                <>
                  <div className="flex justify-between"><span className="text-slate-500 font-sans">Department:</span><span>{viewingUser.lecturerProfile?.department || 'CSE'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500 font-sans">Phone:</span><span>{viewingUser.lecturerProfile?.phone || 'N/A'}</span></div>
                </>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button onClick={() => setShowViewUserModal(false)} className="px-4 py-2 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Edit Student */}
      {showEditStudentModal && editingStudent && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="font-bold text-base text-slate-900 dark:text-white">Edit Student Details</h3>
            <form onSubmit={handleSaveEditStudent} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">Full Name</label>
                <input type="text" value={editStudentName} onChange={(e) => setEditStudentName(e.target.value)} required className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">Email Address</label>
                <input type="email" value={editStudentEmail} onChange={(e) => setEditStudentEmail(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-mono" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">Roll Number</label>
                  <input type="text" value={editStudentRoll} onChange={(e) => setEditStudentRoll(e.target.value)} required className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-mono" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">Academic Year</label>
                  <select value={editStudentYear} onChange={(e) => setEditStudentYear(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white">
                    <option value="1">1st Year</option>
                    <option value="2">2nd Year</option>
                    <option value="3">3rd Year</option>
                    <option value="4">4th Year</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">Branch (Manual Override)</label>
                <select value={editStudentBranchId} onChange={(e) => setEditStudentBranchId(e.target.value)} required className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white">
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name} (Year {b.year})</option>)}
                </select>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button type="button" onClick={() => setShowEditStudentModal(false)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold">Cancel</button>
                <button type="submit" className="px-4 py-2 rounded-xl bg-brand-olive-700 text-white text-xs font-semibold">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Reset Password (Student & Lecturer) */}
      {showResetPasswordModal && targetResetUser && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="font-bold text-base text-slate-900 dark:text-white flex items-center space-x-2">
              <Key className="w-5 h-5 text-amber-500" />
              <span>Reset Password for {targetResetUser.name}</span>
            </h3>
            <form onSubmit={handleResetPassword} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">New Password</label>
                <input type="password" placeholder="Enter new password" value={newPasswordInput} onChange={(e) => setNewPasswordInput(e.target.value)} required className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white" />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button type="button" onClick={() => setShowResetPasswordModal(false)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold">Cancel</button>
                <button type="submit" className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold">Reset Password</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Create/Edit Branch */}
      {showBranchModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="font-bold text-base text-slate-900 dark:text-white">{editingBranchId ? 'Edit Branch' : 'Create New Branch'}</h3>
            <form onSubmit={handleSaveBranch} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">Branch Name (e.g. CSE-1, CSE-2)</label>
                <input type="text" value={branchName} onChange={(e) => setBranchName(e.target.value)} required className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">Academic Year</label>
                <select value={branchYear} onChange={(e) => setBranchYear(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white">
                  <option value="1">1st Year</option>
                  <option value="2">2nd Year</option>
                  <option value="3">3rd Year</option>
                  <option value="4">4th Year</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">Roll Start</label>
                  <input type="text" placeholder="160125733001" value={rollStart} onChange={(e) => setRollStart(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-mono" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">Roll End</label>
                  <input type="text" placeholder="160125733060" value={rollEnd} onChange={(e) => setRollEnd(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-mono" />
                </div>
              </div>
              <div className="flex justify-end space-x-2 pt-2">
                <button type="button" onClick={() => setShowBranchModal(false)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold">Cancel</button>
                <button type="submit" className="px-4 py-2 rounded-xl bg-brand-olive-700 text-white text-xs font-semibold">Save Branch</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Create/Edit Subject */}
      {showSubjectModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="font-bold text-base text-slate-900 dark:text-white">{editingSubjectId ? 'Edit Subject' : 'Create New Subject'}</h3>
            <form onSubmit={handleSaveSubject} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">Subject Name (e.g. Java Programming Lab)</label>
                <input type="text" value={subName} onChange={(e) => setSubName(e.target.value)} required className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">Subject Code</label>
                  <input type="text" placeholder="CS202L" value={subCode} onChange={(e) => setSubCode(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-mono" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">Semester</label>
                  <input type="number" placeholder="4" value={subSemester} onChange={(e) => setSubSemester(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">Academic Year</label>
                  <select value={subYear} onChange={(e) => setSubYear(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white">
                    <option value="1">1st Year</option>
                    <option value="2">2nd Year</option>
                    <option value="3">3rd Year</option>
                    <option value="4">4th Year</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">Target Branch</label>
                  <select value={subBranchId} onChange={(e) => setSubBranchId(e.target.value)} required className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white">
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name} (Yr {b.year})</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">Assigned Faculty Lecturer</label>
                <select value={subLecturerId} onChange={(e) => setSubLecturerId(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white">
                  <option value="">Unassigned</option>
                  {lecturers.map((lec) => <option key={lec.id} value={lec.id}>{lec.name} ({lec.email})</option>)}
                </select>
              </div>
              <div className="flex justify-end space-x-2 pt-2">
                <button type="button" onClick={() => setShowSubjectModal(false)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold">Cancel</button>
                <button type="submit" className="px-4 py-2 rounded-xl bg-brand-blue-600 text-white text-xs font-semibold">Save Subject</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Lecturer */}
      {showAddLecturerModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="font-bold text-base text-slate-900 dark:text-white">{editingLecturerId ? 'Edit Faculty Lecturer' : 'Add Faculty Lecturer'}</h3>
            <form onSubmit={handleSaveLecturer} className="space-y-3">
              <input type="text" placeholder="Full Name (e.g. Dr. Ravi)" value={lecName} onChange={(e) => setLecName(e.target.value)} required className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white" />
              <input type="email" placeholder="Email (e.g. ravi@cbit.in)" value={lecEmail} onChange={(e) => setLecEmail(e.target.value)} required className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-mono" />
              {!editingLecturerId && (
                <input type="password" placeholder="Password" value={lecPassword} onChange={(e) => setLecPassword(e.target.value)} required className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white" />
              )}
              <input type="text" placeholder="Department (e.g. CSE)" value={lecDepartment} onChange={(e) => setLecDepartment(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white" />
              <div className="flex justify-end space-x-2 pt-2">
                <button type="button" onClick={() => setShowAddLecturerModal(false)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold">Cancel</button>
                <button type="submit" className="px-4 py-2 rounded-xl bg-brand-blue-600 text-white text-xs font-semibold">Save Faculty</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ProfileModal isOpen={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
