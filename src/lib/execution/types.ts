// Type-only import: node-pty is a native addon that only exists on the execution
// host (Railway). This file is also pulled into the Next.js build (via lib/compiler
// -> execution/types) which runs on Vercel, where node-pty is not installed. Keeping
// this `import type` means the reference is erased at compile time and never emitted.
import type { IPty } from 'node-pty';

export type SupportedLanguage = 'c' | 'cpp' | 'java' | 'python' | 'javascript' | 'text';

export interface SourceFile {
  filename: string;
  content: string;
}

export interface ExecutionLimits {
  timeoutMs: number;
  maxOutputBytes: number;
}

export const DEFAULT_EXECUTION_LIMITS: ExecutionLimits = {
  timeoutMs: 60000, // 60 seconds max active runtime limit
  maxOutputBytes: 5 * 1024 * 1024, // 5 MB max output buffer cap
};

export interface ExecutionSession {
  sessionId: string;
  language: SupportedLanguage;
  tempDir: string;
  filename: string;
  startTime: number;
  ptyProcess: IPty | null;
  timeoutTimer: NodeJS.Timeout | null;
  outputByteCount: number;
  isCleaningUp: boolean;
}

export interface CompilationResult {
  success: boolean;
  compileCmd: string | null;
  stdout: string;
  stderr: string;
  compilationTimeMs: number;
  mainFilePath: string;
  executablePath?: string;
  runCmd: string;
  runArgs: string[];
}

export interface CodeExecutionRequest {
  filename: string;
  code: string;
  stdin?: string;
  files?: SourceFile[];
}

export interface CodeExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  compilationError: boolean;
  executionTimeMs: number;
  exitCode: number | null;
  language: string;
}

export type WsClientMessage =
  | {
      type: 'run';
      filename: string;
      code: string;
      files?: SourceFile[];
      cols?: number;
      rows?: number;
      token: string;
      labId: string;
      // Client-volunteered device class. Only ever narrows eligibility server-side —
      // see src/lib/deviceEligibility.ts.
      deviceClass?: string;
    }
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'stop' };

export type WsServerMessage =
  | { type: 'status'; status: 'compiling' | 'running' | 'idle' }
  // `system: true` marks output the platform itself wrote (compilation banners, exit
  // notices, limit warnings) as opposed to the program's own stdout/stderr. The terminal
  // renders both identically; only unmarked output is captured as the program's output
  // for the answer sheet, so a student's Output section never contains our banners.
  | { type: 'output'; data: string; system?: boolean }
  | { type: 'exit'; exitCode: number; executionTimeMs: number }
  | { type: 'error'; code: string; message: string };

export function detectLanguage(filename: string): SupportedLanguage {
  const ext = filename.slice(((filename.lastIndexOf('.') - 1) >>> 0) + 2).toLowerCase();
  switch (ext) {
    case 'c':
      return 'c';
    case 'cpp':
    case 'cc':
    case 'cxx':
      return 'cpp';
    case 'java':
      return 'java';
    case 'py':
      return 'python';
    case 'js':
    case 'jsx':
      return 'javascript';
    default:
      return 'text';
  }
}
