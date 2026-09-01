'use client';

import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { detectClientDeviceClass } from '@/lib/useDeviceClass';
import {
  Terminal as TerminalIcon,
  Square,
  Copy,
  RotateCcw,
  Loader2,
} from 'lucide-react';

// A single program run, captured so the answer sheet's Input and Output sections can be
// filled from what actually executed rather than retyped from memory. Capture is
// client-side and in-memory only — this does not persist an execution record.
export interface CapturedRun {
  filename: string;
  /** Keystrokes the student typed into the running program, newline-separated. */
  stdin: string;
  /** The program's own output, ANSI stripped. Excludes the platform's own banners. */
  stdout: string;
  finished: boolean;
}

export interface TerminalRef {
  runCode: (params: {
    filename: string;
    code: string;
    files?: { filename: string; content: string }[];
    labId: string;
    token: string;
  }) => void;
  stopProgram: () => void;
  clear: () => void;
  focus: () => void;
}

interface TerminalProps {
  onStatusChange?: (isRunning: boolean) => void;
  /** Fires as a run progresses and when it ends, with what the program read and wrote. */
  onRunCaptured?: (run: CapturedRun) => void;
}

// xterm renders ANSI; a lab record should not contain escape codes. Strips CSI/OSC
// sequences and normalises CRLF, leaving the plain text a student would write down.
export function stripAnsi(input: string): string {
  return input
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[@-Z\\-_]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

export const Terminal = forwardRef<TerminalRef, TerminalProps>(({ onStatusChange, onRunCaptured }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [status, setStatus] = useState<'idle' | 'compiling' | 'running'>('idle');
  const [executionTimeMs, setExecutionTimeMs] = useState<number | null>(null);
  const isRunning = status === 'compiling' || status === 'running';

  const isRunningRef = useRef(isRunning);
  isRunningRef.current = isRunning;

  // Live capture of the current run. Refs, not state: output arrives in many small chunks
  // and re-rendering the terminal on each one would be wasteful and jittery.
  const captureRef = useRef<CapturedRun>({ filename: '', stdin: '', stdout: '', finished: false });
  const onRunCapturedRef = useRef(onRunCaptured);
  onRunCapturedRef.current = onRunCaptured;

  const emitCapture = () => {
    onRunCapturedRef.current?.({ ...captureRef.current });
  };

  // Initialize WebSocket connection
  const connectWebSocket = () => {
    if (typeof window === 'undefined') return;

    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    // The execution engine (node-pty + gcc/javac) cannot run on Vercel, so in
    // production it lives on a separate Railway host. NEXT_PUBLIC_WS_URL points at
    // that host, e.g. wss://labsubmit-engine.up.railway.app/api/ws.
    // When unset (local dev, or single-host Docker deploy) fall back to same-origin.
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl =
      process.env.NEXT_PUBLIC_WS_URL || `${protocol}//${window.location.host}/api/ws`;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[Terminal WS] Connected to interactive PTY server');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log(`[STAGE: FRONTEND WS MESSAGE] Type: ${msg.type}`);
        const term = xtermRef.current;

        if (msg.type === 'status') {
          setStatus(msg.status);
          if (onStatusChange) {
            onStatusChange(msg.status === 'compiling' || msg.status === 'running');
          }
        } else if (msg.type === 'output') {
          // Only the program's own output is captured; platform banners carry system:true.
          if (!msg.system) {
            captureRef.current.stdout += stripAnsi(msg.data);
          }
          if (term) {
            term.write(msg.data);
          } else {
            console.warn('[STAGE: FRONTEND WARNING] xterm instance not ready yet for output chunk');
          }
        } else if (msg.type === 'exit') {
          setStatus('idle');
          setExecutionTimeMs(msg.executionTimeMs ?? null);
          captureRef.current.finished = true;
          emitCapture();
          if (onStatusChange) {
            onStatusChange(false);
          }
        } else if (msg.type === 'error') {
          if (term) {
            term.write(`\r\n\x1b[31m[${msg.code}] ${msg.message}\x1b[0m\r\n`);
          }
          setStatus('idle');
          if (onStatusChange) {
            onStatusChange(false);
          }
        }
      } catch (e) {
        console.error('[Terminal WS] Error handling socket message:', e);
      }
    };

    ws.onclose = () => {
      console.warn('[Terminal WS] Socket closed, reconnecting in 1s...');
      wsRef.current = null;
      setTimeout(() => {
        connectWebSocket();
      }, 1000);
    };

    ws.onerror = (err) => {
      console.error('[Terminal WS] Socket error:', err);
    };

    wsRef.current = ws;
  };

  // Initialize xterm.js instance
  useEffect(() => {
    let term: any = null;

    const initTerminal = async () => {
      if (typeof window === 'undefined' || !containerRef.current) return;

      try {
        const { Terminal: XTerminal } = await import('xterm');
        const { FitAddon } = await import('xterm-addon-fit');

        if (!document.getElementById('xterm-css')) {
          const link = document.createElement('link');
          link.id = 'xterm-css';
          link.rel = 'stylesheet';
          link.href = 'https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css';
          document.head.appendChild(link);
        }

        term = new XTerminal({
          cursorBlink: true,
          disableStdin: false,
          fontSize: 13,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          theme: {
            background: '#090d16',
            foreground: '#e2e8f0',
            cursor: '#34d399',
            selectionBackground: '#1e293b',
            black: '#0f172a',
            red: '#f87171',
            green: '#4ade80',
            yellow: '#fbbf24',
            blue: '#60a5fa',
            magenta: '#c084fc',
            cyan: '#38bdf8',
            white: '#f8fafc',
          },
          convertEol: true,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);

        if (containerRef.current) {
          containerRef.current.innerHTML = '';
          term.open(containerRef.current);
          fitAddon.fit();
          term.focus();
        }

        // Direct keystroke listener -> WebSocket
        term.onData((data: string) => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'input', data }));
          }

          // Reconstruct what the student actually entered: apply backspace, keep newlines,
          // and drop control keys (arrows, escapes) that are not part of the input.
          if (data === '\x7f' || data === '\b') {
            captureRef.current.stdin = captureRef.current.stdin.slice(0, -1);
          } else if (data === '\r' || data === '\n') {
            captureRef.current.stdin += '\n';
          } else if (!/[\x00-\x1f]/.test(data)) {
            captureRef.current.stdin += data;
          }
        });

        // Resize listener -> WebSocket
        term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
          }
        });

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        // Resize handler for browser window
        const handleResize = () => {
          try {
            fitAddon.fit();
          } catch (e) {}
        };
        window.addEventListener('resize', handleResize);

        connectWebSocket();

        return () => {
          window.removeEventListener('resize', handleResize);
        };
      } catch (err) {
        console.error('Failed to initialize xterm.js terminal:', err);
      }
    };

    initTerminal();

    return () => {
      if (term) {
        try {
          term.dispose();
        } catch (e) {}
      }
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch (e) {}
        wsRef.current = null;
      }
    };
  }, []);

  // Expose imperatives
  useImperativeHandle(ref, () => ({
    runCode: ({ filename, code, files, labId, token }) => {
      console.log(`[STAGE: 1. RUN CODE CALLED IN TERMINAL] Target: "${filename}"`);
      setExecutionTimeMs(null);
      // Each run captures itself from scratch — the answer sheet offers the LAST run,
      // never an accumulation across runs.
      captureRef.current = { filename, stdin: '', stdout: '', finished: false };
      emitCapture();
      const term = xtermRef.current;
      if (term) {
        term.reset();
        try {
          term.focus();
        } catch (e) {}
      }

      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        connectWebSocket();
      }

      const sendRun = () => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          const cols = term ? term.cols : 80;
          const rows = term ? term.rows : 24;
          wsRef.current.send(
            JSON.stringify({
              type: 'run',
              filename,
              code,
              files,
              cols,
              rows,
              labId,
              token,
              // Narrow-only hint for the server's exam-device check (iPadOS reports a
              // desktop UA); the server decides, and ignores this unless it is stricter.
              deviceClass: detectClientDeviceClass(),
            })
          );
          setTimeout(() => {
            try {
              term?.focus();
            } catch (e) {}
          }, 50);
        } else {
          setTimeout(sendRun, 100);
        }
      };

      sendRun();
    },
    stopProgram: () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'stop' }));
      }
      setStatus('idle');
      if (onStatusChange) onStatusChange(false);
    },
    clear: () => {
      if (xtermRef.current) {
        xtermRef.current.reset();
      }
    },
    focus: () => {
      if (xtermRef.current) {
        try {
          xtermRef.current.focus();
        } catch (e) {}
      }
    },
  }));

  const handleCopy = () => {
    if (xtermRef.current) {
      xtermRef.current.selectAll();
      const selection = xtermRef.current.getSelection();
      navigator.clipboard.writeText(selection);
      xtermRef.current.clearSelection();
    }
  };

  const handleClear = () => {
    if (xtermRef.current) {
      xtermRef.current.reset();
    }
  };

  const handleStop = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stop' }));
    }
    setStatus('idle');
    if (onStatusChange) onStatusChange(false);
  };

  const focusTerminal = () => {
    if (xtermRef.current) {
      try {
        xtermRef.current.focus();
      } catch (e) {}
    }
  };

  const handleContainerClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    focusTerminal();
  };

  return (
    <div
      className="h-64 bg-slate-950 border-t border-slate-800 flex flex-col font-mono text-xs cursor-text outline-none focus:outline-none"
      onClick={handleContainerClick}
    >
      {/* Header Bar */}
      <div className="h-9 bg-slate-900 border-b border-slate-800 px-4 flex items-center justify-between select-none">
        <div className="flex items-center space-x-3">
          <TerminalIcon className="w-4 h-4 text-emerald-400" />
          <span className="font-semibold text-xs text-slate-200">Terminal (Interactive PTY)</span>

          {status === 'compiling' && (
            <span className="text-[11px] text-amber-400 font-medium flex items-center space-x-1 bg-amber-950/60 border border-amber-800/80 px-2 py-0.5 rounded-md">
              <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
              <span>Compiling...</span>
            </span>
          )}

          {status === 'running' && (
            <span className="text-[11px] text-emerald-400 font-medium flex items-center space-x-1 bg-emerald-950/60 border border-emerald-800/80 px-2 py-0.5 rounded-md">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span>Process Active</span>
            </span>
          )}

          {!isRunning && executionTimeMs !== null && (
            <span className="text-[11px] text-slate-400">
              Finished in {executionTimeMs} ms
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {isRunning && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleStop();
              }}
              className="px-2.5 py-1 rounded bg-red-950/80 hover:bg-red-900 border border-red-800 text-red-300 text-[11px] font-medium flex items-center space-x-1 transition-colors"
              title="Terminate Process Session (SIGKILL)"
            >
              <Square className="w-3 h-3 fill-current text-red-400" />
              <span>Stop Program</span>
            </button>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              handleCopy();
            }}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors flex items-center space-x-1 text-[11px]"
            title="Copy Terminal Selection"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copy</span>
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              handleClear();
            }}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors flex items-center space-x-1 text-[11px]"
            title="Clear Terminal Screen"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* xterm.js canvas element */}
      <div
        ref={containerRef}
        tabIndex={0}
        className="flex-1 p-2 bg-[#090d16] overflow-hidden outline-none focus:outline-none cursor-text"
        onClick={handleContainerClick}
        onFocus={focusTerminal}
      />
    </div>
  );
});

Terminal.displayName = 'Terminal';
