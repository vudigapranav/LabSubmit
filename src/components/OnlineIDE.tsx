'use client';

import React, { useState, useEffect, useRef } from 'react';
import Editor, { loader } from '@monaco-editor/react';

// Serve Monaco from this app (public/monaco, copied at build time) instead of the default
// jsdelivr CDN, so the exam editor works on a lab network without that CDN.
loader.config({ paths: { vs: '/monaco/vs' } });
import { useApp } from '@/context/AppContext';
import { AntiCheatWrapper } from './AntiCheatWrapper';
import { detectClientDeviceClass } from '@/lib/useDeviceClass';
import { useFileAutosave, type FlushOutcome } from '@/lib/useFileAutosave';
import { QuestionPaper } from './QuestionPaper';
import { Terminal, TerminalRef, CapturedRun } from './Terminal';
import {
  Play,
  Send,
  FileCode,
  Plus,
  Trash2,
  Edit2,
  X,
  Lock,
  Code,
  BookOpen,
} from 'lucide-react';

interface LabFile {
  id: string;
  filename: string;
  content: string;
  language: string;
  updatedAt?: string | null;
}

// Extension is always derived from an explicit language choice in the New Source File
// modal — never free-typed — so a file's extension can never disagree with its language
// (which was the cause of a real bug: a student typed "main.cpp" by habit but wrote Java
// code in it, and the compiler correctly-but-confusingly compiled it as C++).
const NEW_FILE_LANGUAGE_OPTIONS: { value: string; label: string; ext: string; defaultBaseName: string }[] = [
  { value: 'c', label: 'C', ext: 'c', defaultBaseName: 'main' },
  { value: 'cpp', label: 'C++', ext: 'cpp', defaultBaseName: 'main' },
  { value: 'java', label: 'Java', ext: 'java', defaultBaseName: 'Main' },
  { value: 'python', label: 'Python', ext: 'py', defaultBaseName: 'main' },
  { value: 'javascript', label: 'JavaScript (Node.js)', ext: 'js', defaultBaseName: 'main' },
];

interface OnlineIDEProps {
  labId: string;
  labTitle: string;
  problemStatement: string;
  readOnly?: boolean;
  initialFiles?: LabFile[];
  isSubmitted?: boolean;
  onSubmittedSuccess?: () => void;
  allowCopy?: boolean;
  allowPaste?: boolean;
  allowCut?: boolean;
  allowRightClick?: boolean;
  allowDragDrop?: boolean;
  onViolation?: (type: string, details?: string) => void;
  allowedLanguages?: string[];
  /**
   * Fill the parent's height instead of assuming the IDE owns the viewport. Set when the
   * IDE shares the page with the answer sheet; left off elsewhere (e.g. the faculty
   * Submission Inspector modal) so those layouts are unchanged.
   */
  fillParent?: boolean;
  /** Surfaces each program run so the answer sheet can offer its real input/output. */
  onRunCaptured?: (run: CapturedRun) => void;
  /**
   * The questions on this student's assigned paper. Carries no set identity — see
   * toStudentPaper() in src/lib/questionSets.ts. Falls back to `problemStatement` for exams
   * that have no question sets.
   */
  questions?: { order: number; text: string; marks: number | null }[];
  /** Filled with a function that saves every unsaved file — the page calls it before an auto-submit. */
  flushRef?: React.MutableRefObject<(() => Promise<FlushOutcome>) | null>;
}

export const OnlineIDE: React.FC<OnlineIDEProps> = ({
  labId,
  labTitle,
  problemStatement,
  readOnly = false,
  initialFiles = [],
  isSubmitted = false,
  onSubmittedSuccess,
  allowCopy = false,
  allowPaste = false,
  allowCut = false,
  allowRightClick = false,
  allowDragDrop = false,
  onViolation,
  allowedLanguages,
  fillParent = false,
  onRunCaptured,
  questions,
  flushRef,
}) => {
  const { token, theme } = useApp();
  const newFileLanguageOptions = allowedLanguages && allowedLanguages.length > 0
    ? NEW_FILE_LANGUAGE_OPTIONS.filter((o) => allowedLanguages.includes(o.value))
    : NEW_FILE_LANGUAGE_OPTIONS;
  const [files, setFiles] = useState<LabFile[]>(initialFiles);
  const [activeFileId, setActiveFileId] = useState<string>('');
  
  // Terminal state & ref
  const terminalRef = useRef<TerminalRef>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [workspaceSubmitted, setWorkspaceSubmitted] = useState<boolean>(isSubmitted);
  const [showProblemModal, setShowProblemModal] = useState<boolean>(false);

  // File management modal inputs
  const [newFileLanguage, setNewFileLanguage] = useState<string>('');
  const [newFileBaseName, setNewFileBaseName] = useState<string>('');
  const [showAddFileModal, setShowAddFileModal] = useState<boolean>(false);
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState<string>('');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Saves every edit (see src/lib/useFileAutosave.ts). Off for read-only views and once submitted.
  const autosave = useFileAutosave({ labId, token, enabled: !readOnly && !workspaceSubmitted });
  useEffect(() => {
    if (flushRef) flushRef.current = autosave.flush;
  }, [flushRef, autosave.flush]);

  useEffect(() => {
    fetchWorkspace();
  }, [labId]);

  const showToast = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  const fetchWorkspace = async () => {
    try {
      const res = await fetch(`/api/student/workspace?labId=${labId}`, {
        headers: { Authorization: `Bearer ${token || localStorage.getItem('cbit_token')}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.workspace && data.workspace.files.length > 0) {
          // Crash/refresh recovery: restore local drafts only where the server copy is unchanged.
          const { files: loaded, restored, discarded } = data.workspace.isSubmitted
            ? { files: data.workspace.files, restored: [], discarded: [] }
            : autosave.reconcile<LabFile>(data.workspace.files);
          setFiles(loaded);
          setActiveFileId(loaded[0].id);
          if (restored.length > 0) {
            showToast('success', `Recovered unsaved changes in ${restored.length} file(s) from this browser. Saving them now.`);
          } else if (discarded.length > 0) {
            showToast('error', `An older unsaved draft of ${discarded.length} file(s) was not restored because the saved version is newer.`);
          }
          setWorkspaceSubmitted(data.workspace.isSubmitted);
        }
      }
    } catch (err) {
      console.error('Failed to load workspace:', err);
    }
  };

  const activeFile = files.find((f) => f.id === activeFileId) || files[0];

  const handleCodeChange = (value: string | undefined) => {
    if (!activeFile || workspaceSubmitted || readOnly) return;
    const newContent = value || '';
    setFiles((prev) =>
      prev.map((f) => (f.id === activeFile.id ? { ...f, content: newContent } : f))
    );
    autosave.markDirty({ id: activeFile.id, content: newContent, updatedAt: activeFile.updatedAt });
  };

  // Saves EVERY file with unsaved edits (it used to save only the active one).
  const saveActiveFile = async (): Promise<FlushOutcome> => {
    if (workspaceSubmitted || readOnly) return 'saved';
    return autosave.flush();
  };

  const handleCreateFile = async () => {
    const baseName = newFileBaseName.trim();
    if (!baseName) return;
    if (baseName.includes('.') || baseName.includes('/') || baseName.includes('\\')) {
      showToast('error', 'File name should not include a dot or path separator — just the name, e.g. "Main" or "input".');
      return;
    }
    const langOption = newFileLanguageOptions.find((o) => o.value === newFileLanguage) || newFileLanguageOptions[0];
    const filename = `${baseName}.${langOption.ext}`;
    try {
      const res = await fetch('/api/student/workspace', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token || localStorage.getItem('cbit_token')}`,
          'X-LabSubmit-Device-Class': detectClientDeviceClass(),
        },
        body: JSON.stringify({
          action: 'create_file',
          labId,
          filename,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setFiles((prev) => [...prev, data.file]);
        setActiveFileId(data.file.id);
        setShowAddFileModal(false);
        setNewFileBaseName('');
        showToast('success', `File "${filename}" created.`);
      } else {
        showToast('error', data.error || 'Failed to create file');
      }
    } catch (err) {
      showToast('error', 'Error creating file');
    }
  };

  const handleRenameFile = async (fileId: string) => {
    if (!renameInput.trim()) return;
    try {
      const res = await fetch('/api/student/workspace', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token || localStorage.getItem('cbit_token')}`,
          'X-LabSubmit-Device-Class': detectClientDeviceClass(),
        },
        body: JSON.stringify({
          action: 'rename_file',
          labId,
          fileId,
          newFilename: renameInput.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setFiles((prev) => prev.map((f) => (f.id === fileId ? data.file : f)));
        setEditingFileId(null);
        showToast('success', 'File renamed');
      } else {
        showToast('error', data.error || 'Failed to rename file');
      }
    } catch (e) {
      showToast('error', 'Error renaming file');
    }
  };

  const handleDeleteFile = async (fileId: string, filename: string) => {
    if (files.length <= 1) {
      showToast('error', 'Workspace must contain at least one file');
      return;
    }
    if (!confirm(`Are you sure you want to delete "${filename}"?`)) return;

    try {
      const res = await fetch('/api/student/workspace', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token || localStorage.getItem('cbit_token')}`,
          'X-LabSubmit-Device-Class': detectClientDeviceClass(),
        },
        body: JSON.stringify({
          action: 'delete_file',
          labId,
          fileId,
        }),
      });
      if (res.ok) {
        autosave.forget(fileId);
        const remaining = files.filter((f) => f.id !== fileId);
        setFiles(remaining);
        if (activeFileId === fileId && remaining.length > 0) {
          setActiveFileId(remaining[0].id);
        }
        showToast('success', `File "${filename}" deleted`);
      } else {
        const data = await res.json();
        showToast('error', data.error || 'Failed to delete file');
      }
    } catch (e) {
      showToast('error', 'Error deleting file');
    }
  };

  // INTERACTIVE PTY LAUNCHER VIA WEBSOCKET
  const handleRunCode = async () => {
    if (!activeFile) return;
    await saveActiveFile();
    if (terminalRef.current) {
      terminalRef.current.runCode({
        filename: activeFile.filename,
        code: activeFile.content,
        files: files.map((f) => ({ filename: f.filename, content: f.content })),
        labId,
        token: token || localStorage.getItem('cbit_token') || '',
      });
    }
  };

  const handleStopProgram = () => {
    if (terminalRef.current) {
      terminalRef.current.stopProgram();
    }
  };

  const handleSubmitLab = async () => {
    if (workspaceSubmitted) return;
    if (!confirm('Are you sure you want to submit your lab assessment? Once submitted, your workspace will be locked.')) return;

    const saved = await saveActiveFile();
    if (saved === 'retrying' || saved === 'pending') {
      // Submitting now would hand in older code than the student sees. A server REFUSAL (e.g.
      // the deadline passed) is different: the server holds what it accepted, so submit that.
      showToast('error', 'Your latest changes are not saved yet (connection problem). Check your connection and press Submit again.');
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/student/workspace', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('cbit_token')}`,
          'X-LabSubmit-Device-Class': detectClientDeviceClass(),
        },
        body: JSON.stringify({
          action: 'submit_lab',
          labId,
        }),
      });
      const data = await res.json();
      setIsSubmitting(false);
      if (res.ok) {
        setWorkspaceSubmitted(true);
        showToast('success', data.message || 'Lab submitted successfully!');
        if (onSubmittedSuccess) onSubmittedSuccess();
      } else {
        showToast('error', data.error || 'Failed to submit lab');
      }
    } catch (e) {
      setIsSubmitting(false);
      showToast('error', 'Error submitting lab');
    }
  };

  const getMonacoLanguage = (lang: string) => {
    switch (lang) {
      case 'c':
      case 'cpp':
        return 'cpp';
      case 'java':
        return 'java';
      // Python files used to fall through to 'plaintext' — no syntax highlighting at all.
      case 'python':
        return 'python';
      case 'javascript':
        return 'javascript';
      default:
        return 'plaintext';
    }
  };

  return (
    <AntiCheatWrapper
      active={!readOnly && !workspaceSubmitted}
      allowCopy={allowCopy}
      allowPaste={allowPaste}
      allowCut={allowCut}
      allowRightClick={allowRightClick}
      allowDragDrop={allowDragDrop}
      onViolation={onViolation}
    >
      <div className={`flex flex-col ${fillParent ? 'h-full' : 'h-[calc(100vh-5rem)]'} w-full bg-slate-950 text-slate-100 rounded-card overflow-hidden shadow-cardHover border border-slate-800`}>
        {notification && (
          <div
            className={`px-4 py-2 text-xs font-semibold flex items-center justify-between transition-colors ${
              notification.type === 'success' ? 'bg-brand-olive-700 text-white' : 'bg-rose-600 text-white'
            }`}
          >
            <span>{notification.message}</span>
            <button onClick={() => setNotification(null)}>
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {workspaceSubmitted && (
          <div className="bg-amber-900/60 text-amber-200 px-4 py-2 text-xs font-medium flex items-center justify-between border-b border-amber-800/80">
            <div className="flex items-center space-x-2">
              <Lock className="w-3.5 h-3.5" />
              <span>Workspace Locked: Assessment submitted. Files are read-only.</span>
            </div>
          </div>
        )}

        {/* Top Control Header */}
        <div className="h-12 bg-slate-900 border-b border-slate-800 px-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Code className="w-4 h-4 text-slate-400" />
            <h2 className="font-semibold text-xs text-slate-200 max-w-xs sm:max-w-md truncate">
              {labTitle}
            </h2>

            {!readOnly && !workspaceSubmitted && (
              <span
                role="status"
                aria-live="polite"
                title={autosave.message || undefined}
                className={`text-[11px] font-medium ${
                  autosave.status === 'error' ? 'text-rose-400' : autosave.status === 'retrying' ? 'text-amber-400' : 'text-slate-400'
                }`}
              >
                {autosave.status === 'saved' && 'All changes saved'}
                {autosave.status === 'saving' && 'Saving…'}
                {autosave.status === 'unsaved' && 'Unsaved changes'}
                {autosave.status === 'retrying' && 'Offline — your work is kept in this browser and will be saved when you reconnect'}
                {autosave.status === 'error' && `Not saved: ${autosave.message || 'the server refused the change'}`}
              </span>
            )}

            {/* Problem Statement Overlay Modal Toggle */}
            <button
              onClick={() => setShowProblemModal(true)}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium flex items-center space-x-1.5 border border-slate-700 transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5 text-brand-blue-400" />
              <span>Problem Statement</span>
            </button>
          </div>

          <div className="flex items-center space-x-2">
            {/* Run Code Button */}
            <button
              onClick={handleRunCode}
              disabled={isRunning}
              className="flex items-center space-x-1.5 px-4 py-1.5 rounded-lg bg-brand-olive-700 hover:bg-brand-olive-600 disabled:opacity-50 text-white text-xs font-medium transition-colors shadow-card"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{isRunning ? 'Running...' : 'Run Code'}</span>
            </button>

            {/* Submit Lab Button */}
            {!readOnly && (
              <button
                onClick={handleSubmitLab}
                disabled={workspaceSubmitted || isSubmitting}
                className={`flex items-center space-x-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-colors shadow-card ${
                  workspaceSubmitted
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                    : 'bg-brand-blue-600 hover:bg-brand-blue-500 text-white'
                }`}
              >
                <Send className="w-3.5 h-3.5" />
                <span>{workspaceSubmitted ? 'Submitted' : isSubmitting ? 'Submitting...' : 'Submit Lab'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Main Editor Split */}
        <div className="flex-1 flex overflow-hidden">
          {/* File Explorer Sidebar */}
          <div className="w-52 bg-slate-900 border-r border-slate-800 flex flex-col">
            <div className="p-3 border-b border-slate-800 flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Files</span>
              {!readOnly && !workspaceSubmitted && (
                <button
                  onClick={() => {
                    const first = newFileLanguageOptions[0];
                    setNewFileLanguage(first?.value || 'c');
                    setNewFileBaseName('');
                    setShowAddFileModal(true);
                  }}
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800"
                  title="New Source File"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {files.map((file) => (
                <div
                  key={file.id}
                  className={`group flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-mono cursor-pointer transition-colors ${
                    activeFileId === file.id
                      ? 'bg-slate-800 text-white font-semibold border border-slate-700'
                      : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                  }`}
                  onClick={() => setActiveFileId(file.id)}
                >
                  <div className="flex items-center space-x-2 truncate">
                    <FileCode className="w-3.5 h-3.5 text-slate-400" />
                    {editingFileId === file.id ? (
                      <input
                        type="text"
                        value={renameInput}
                        onChange={(e) => setRenameInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameFile(file.id);
                          if (e.key === 'Escape') setEditingFileId(null);
                        }}
                        className="bg-slate-950 text-white px-1 py-0.5 rounded text-xs w-24 focus:outline-none"
                        autoFocus
                      />
                    ) : (
                      <span className="truncate">{file.filename}</span>
                    )}
                  </div>

                  {!readOnly && !workspaceSubmitted && (
                    <div className="hidden group-hover:flex items-center space-x-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingFileId(file.id);
                          setRenameInput(file.filename);
                        }}
                        className="p-1 text-slate-400 hover:text-white"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteFile(file.id, file.filename);
                        }}
                        className="p-1 text-slate-400 hover:text-red-400"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Monaco Code Editor */}
          <div className="flex-1 flex flex-col min-w-0 bg-slate-950">
            {/* Editor Tabs */}
            <div className="h-9 bg-slate-900 border-b border-slate-800 flex items-center px-2 space-x-1 overflow-x-auto">
              {files.map((file) => (
                <button
                  key={file.id}
                  onClick={() => setActiveFileId(file.id)}
                  className={`px-3 py-1 text-xs font-mono flex items-center space-x-1.5 transition-colors border-t-2 ${
                    activeFileId === file.id
                      ? 'bg-slate-950 border-brand-olive-600 text-white font-semibold'
                      : 'border-transparent text-slate-400 hover:bg-slate-900'
                  }`}
                >
                  <FileCode className="w-3.5 h-3.5 text-slate-400" />
                  <span>{file.filename}</span>
                </button>
              ))}
            </div>

            <div className="flex-1 relative">
              {activeFile ? (
                <Editor
                  height="100%"
                  language={getMonacoLanguage(activeFile.language)}
                  value={activeFile.content}
                  onChange={handleCodeChange}
                  theme="vs-dark"
                  options={{
                    readOnly: readOnly || workspaceSubmitted,
                    fontSize: 13,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 4,
                    lineNumbers: 'on',
                    bracketPairColorization: { enabled: true },
                    cursorBlinking: 'smooth',
                  }}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-slate-500 text-xs">
                  Select or create a file to start coding
                </div>
              )}
            </div>

            {/* SHARED INTEGRATED TERMINAL COMPONENT */}
            <Terminal
              ref={terminalRef}
              onStatusChange={(running) => setIsRunning(running)}
              onRunCaptured={onRunCaptured}
            />
          </div>
        </div>

        {/* Modal: Problem Statement Overlay */}
        {showProblemModal && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-card max-w-2xl w-full p-6 space-y-4 shadow-overlay">
              <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                <div className="flex items-center space-x-2">
                  <BookOpen className="w-4 h-4 text-brand-blue-400" />
                  <h3 className="font-bold text-white text-sm">Problem Statement & Constraints</h3>
                </div>
                <button
                  onClick={() => setShowProblemModal(false)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="bg-slate-950 p-4 rounded-control border border-slate-800 text-xs text-slate-200 leading-relaxed max-h-96 overflow-y-auto">
                <QuestionPaper questions={questions || []} fallbackStatement={problemStatement} surface="dark" />
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setShowProblemModal(false)}
                  className="px-4 py-2 rounded-control bg-brand-olive-700 hover:bg-brand-olive-600 text-white text-xs font-semibold"
                >
                  Return to Workspace
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Create File */}
        {showAddFileModal && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-card max-w-md w-full p-5 space-y-4 shadow-overlay">
              <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                <h3 className="font-bold text-white text-sm">New Source File</h3>
                <button onClick={() => setShowAddFileModal(false)} className="text-slate-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Language</label>
                  <select
                    value={newFileLanguage}
                    onChange={(e) => setNewFileLanguage(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-white focus:outline-none"
                  >
                    {newFileLanguageOptions.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                    {newFileLanguageOptions.length === 0 && <option value="c">C</option>}
                  </select>
                </div>

                <div>
                  <label className="text-xs text-slate-400 block mb-1">
                    Name{' '}
                    {newFileLanguage === 'java' && (
                      <span className="text-amber-400">— must match the public class name exactly</span>
                    )}
                  </label>
                  <div className="flex items-center">
                    <input
                      type="text"
                      placeholder={newFileLanguageOptions.find((o) => o.value === newFileLanguage)?.defaultBaseName || 'main'}
                      value={newFileBaseName}
                      onChange={(e) => setNewFileBaseName(e.target.value)}
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-l px-3 py-2 text-sm text-white focus:outline-none"
                    />
                    <span className="bg-slate-800 border border-l-0 border-slate-800 rounded-r px-3 py-2 text-sm text-slate-400 font-mono">
                      .{newFileLanguageOptions.find((o) => o.value === newFileLanguage)?.ext || 'c'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  onClick={() => setShowAddFileModal(false)}
                  className="px-3.5 py-1.5 rounded bg-slate-800 text-slate-300 text-xs font-medium hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateFile}
                  className="px-3.5 py-1.5 rounded bg-brand-olive-700 text-white text-xs font-medium hover:bg-brand-olive-600"
                >
                  Create File
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AntiCheatWrapper>
  );
};
