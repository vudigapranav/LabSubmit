'use client';

import React, { useEffect, useState } from 'react';
import { ShieldAlert, X } from 'lucide-react';

interface AntiCheatWrapperProps {
  children: React.ReactNode;
  active?: boolean;
  allowCopy?: boolean;
  allowPaste?: boolean;
  allowCut?: boolean;
  allowRightClick?: boolean;
  allowDragDrop?: boolean;
}

export const AntiCheatWrapper: React.FC<AntiCheatWrapperProps> = ({
  children,
  active = true,
  allowCopy = false,
  allowPaste = false,
  allowCut = false,
  allowRightClick = false,
  allowDragDrop = false,
}) => {
  const [warningMsg, setWarningMsg] = useState<string | null>(null);

  const showWarning = (action: string) => {
    setWarningMsg(`⚠️ Action Blocked (${action}): Restricted during this laboratory assessment.`);
    setTimeout(() => {
      setWarningMsg(null);
    }, 4000);
  };

  useEffect(() => {
    if (!active) return;

    // 1. Context menu (right click)
    const handleContextMenu = (e: MouseEvent) => {
      const isTerminal = (e.target as HTMLElement)?.closest('.xterm') !== null;
      if (isTerminal) return;

      if (!allowRightClick) {
        e.preventDefault();
        showWarning('Right Click Context Menu');
      }
    };

    // 2. Copy event
    const handleCopy = (e: ClipboardEvent) => {
      const isTerminal = (e.target as HTMLElement)?.closest('.xterm') !== null;
      if (isTerminal) return;

      if (!allowCopy) {
        e.preventDefault();
        showWarning('Copying Text');
      }
    };

    // 3. Cut event
    const handleCut = (e: ClipboardEvent) => {
      const isTerminal = (e.target as HTMLElement)?.closest('.xterm') !== null;
      if (isTerminal) return;

      if (!allowCut) {
        e.preventDefault();
        showWarning('Cutting Text');
      }
    };

    // 4. Paste event
    const handlePaste = (e: ClipboardEvent) => {
      const isTerminal = (e.target as HTMLElement)?.closest('.xterm') !== null;
      if (isTerminal) return;

      if (!allowPaste) {
        e.preventDefault();
        showWarning('Pasting Code');
      }
    };

    // 5. Drag & Drop
    const handleDragStart = (e: DragEvent) => {
      const isTerminal = (e.target as HTMLElement)?.closest('.xterm') !== null;
      if (isTerminal) return;

      if (!allowDragDrop) {
        e.preventDefault();
        showWarning('Drag & Drop');
      }
    };

    const handleDrop = (e: DragEvent) => {
      const isTerminal = (e.target as HTMLElement)?.closest('.xterm') !== null;
      if (isTerminal) return;

      if (!allowDragDrop) {
        e.preventDefault();
        showWarning('Drag & Drop');
      }
    };

    // 6. Keyboard Shortcuts (Ctrl+C, Ctrl+V, Ctrl+X, Cmd+C, Cmd+V, Cmd+X, Shift+Insert)
    const handleKeyDown = (e: KeyboardEvent) => {
      const isTerminal = (e.target as HTMLElement)?.closest('.xterm') !== null;
      if (isTerminal) return; // Allow natural typing and terminal controls inside xterm

      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (isCtrlOrCmd) {
        if (key === 'c' && !allowCopy) {
          e.preventDefault();
          e.stopPropagation();
          showWarning('Shortcut Ctrl+C');
          return false;
        }
        if (key === 'v' && !allowPaste) {
          e.preventDefault();
          e.stopPropagation();
          showWarning('Shortcut Ctrl+V');
          return false;
        }
        if (key === 'x' && !allowCut) {
          e.preventDefault();
          e.stopPropagation();
          showWarning('Shortcut Ctrl+X');
          return false;
        }
        if (key === 'a' && !allowCopy) {
          // Monaco needs native Ctrl+A ("select all text in this file") to function as
          // an editor — only block Select-All in the surrounding page chrome.
          const isEditor = (e.target as HTMLElement)?.closest('.monaco-editor') !== null;
          if (!isEditor) {
            e.preventDefault();
            e.stopPropagation();
            showWarning('Shortcut Ctrl+A (Select All)');
            return false;
          }
        }
      }

      if (e.shiftKey && e.key === 'Insert' && !allowPaste) {
        e.preventDefault();
        e.stopPropagation();
        showWarning('Shortcut Shift+Insert');
        return false;
      }
    };

    // 7. Middle Mouse Button Paste
    const handleAuxClick = (e: MouseEvent) => {
      const isTerminal = (e.target as HTMLElement)?.closest('.xterm') !== null;
      if (isTerminal) return;

      if (e.button === 1 && !allowPaste) {
        e.preventDefault();
        showWarning('Middle Mouse Paste');
      }
    };

    // Block text selection in page chrome (problem statement modal, file explorer, layout)
    // — never inside Monaco or xterm, both need native selection to function.
    const handleSelectStart = (e: Event) => {
      const target = e.target as HTMLElement;
      const isEditorOrTerminal = target?.closest('.monaco-editor') !== null || target?.closest('.xterm') !== null;
      if (isEditorOrTerminal) return;

      if (!allowCopy) {
        e.preventDefault();
      }
    };

    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('copy', handleCopy);
    window.addEventListener('cut', handleCut);
    window.addEventListener('paste', handlePaste);
    window.addEventListener('dragstart', handleDragStart);
    window.addEventListener('drop', handleDrop);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('auxclick', handleAuxClick);
    window.addEventListener('selectstart', handleSelectStart);

    return () => {
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('copy', handleCopy);
      window.removeEventListener('cut', handleCut);
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('dragstart', handleDragStart);
      window.removeEventListener('drop', handleDrop);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('auxclick', handleAuxClick);
      window.removeEventListener('selectstart', handleSelectStart);
    };
  }, [active, allowCopy, allowPaste, allowCut, allowRightClick, allowDragDrop]);

  return (
    <div className="relative w-full h-full select-none">
      {warningMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-xl w-full px-4 animate-bounce">
          <div className="bg-red-600 text-white px-4 py-3 rounded-lg shadow-2xl flex items-center justify-between border-2 border-red-400">
            <div className="flex items-center space-x-3">
              <ShieldAlert className="w-6 h-6 flex-shrink-0 text-yellow-300" />
              <p className="text-sm font-semibold">{warningMsg}</p>
            </div>
            <button
              onClick={() => setWarningMsg(null)}
              className="text-white hover:text-red-200 p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
      {children}
    </div>
  );
};
