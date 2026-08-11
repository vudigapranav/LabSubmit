'use client';

import React, { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { useApp } from '@/context/AppContext';
import { AntiCheatWrapper } from './AntiCheatWrapper';
import { Terminal, TerminalRef } from './Terminal';
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
}

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
}) => {
  const { token, theme } = useApp();
  const [files, setFiles] = useState<LabFile[]>(initialFiles);
  const [activeFileId, setActiveFileId] = useState<string>('');
  
  // Terminal state & ref
  const terminalRef = useRef<TerminalRef>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [workspaceSubmitted, setWorkspaceSubmitted] = useState<boolean>(isSubmitted);
  const [showProblemModal, setShowProblemModal] = useState<boolean>(false);

  // File management modal inputs
  const [newFilenameInput, setNewFilenameInput] = useState<string>('');
  const [showAddFileModal, setShowAddFileModal] = useState<boolean>(false);
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState<string>('');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

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
          setFiles(data.workspace.files);
          setActiveFileId(data.workspace.files[0].id);
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
  };

  const saveActiveFile = async () => {
    if (!activeFile || workspaceSubmitted || readOnly) return;
    try {
      await fetch('/api/student/workspace', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token || localStorage.getItem('cbit_token')}`,
        },
        body: JSON.stringify({
          action: 'save_file',
          labId,
          fileId: activeFile.id,
          content: activeFile.content,
        }),
      });
    } catch (e) {
      console.error('Auto save error:', e);
    }
  };

  const handleCreateFile = async () => {
    if (!newFilenameInput.trim()) return;
    const filename = newFilenameInput.trim();
    try {
      const res = await fetch('/api/student/workspace', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token || localStorage.getItem('cbit_token')}`,
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
        setNewFilenameInput('');
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
        },
        body: JSON.stringify({
          action: 'delete_file',
          labId,
          fileId,
        }),
      });
      if (res.ok) {
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

    await saveActiveFile();
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/student/workspace', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('cbit_token')}`,
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
    >
      <div className="flex flex-col h-[calc(100vh-5rem)] w-full bg-slate-950 text-slate-100 rounded-2xl overflow-hidden shadow-md border border-slate-800">
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
              className="flex items-center space-x-1.5 px-4 py-1.5 rounded-lg bg-brand-olive-700 hover:bg-brand-olive-600 disabled:opacity-50 text-white text-xs font-medium transition-colors shadow-sm"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{isRunning ? 'Running...' : 'Run Code'}</span>
            </button>

            {/* Submit Lab Button */}
            {!readOnly && (
              <button
                onClick={handleSubmitLab}
                disabled={workspaceSubmitted || isSubmitting}
                className={`flex items-center space-x-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-colors shadow-sm ${
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
                  onClick={() => setShowAddFileModal(true)}
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
            />
          </div>
        </div>

        {/* Modal: Problem Statement Overlay */}
        {showProblemModal && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 space-y-4 shadow-2xl">
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

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-xs text-slate-200 leading-relaxed max-h-96 overflow-y-auto whitespace-pre-wrap">
                {problemStatement}
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setShowProblemModal(false)}
                  className="px-4 py-2 rounded-xl bg-brand-olive-700 hover:bg-brand-olive-600 text-white text-xs font-semibold"
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
            <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
              <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                <h3 className="font-bold text-white text-sm">New Source File</h3>
                <button onClick={() => setShowAddFileModal(false)} className="text-slate-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Filename (.c, .cpp, .java, .js)
                </label>
                <input
                  type="text"
                  placeholder="e.g. main.c, App.java"
                  value={newFilenameInput}
                  onChange={(e) => setNewFilenameInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-white focus:outline-none"
                />
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
