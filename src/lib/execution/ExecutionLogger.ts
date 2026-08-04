import { SupportedLanguage } from './types';

export class ExecutionLogger {
  private static formatTime(): string {
    return new Date().toISOString();
  }

  static logSessionStart(sessionId: string, filename: string, language: SupportedLanguage, fileCount: number) {
    console.log(
      `\x1b[36m[EXECUTION SYSTEM] [${this.formatTime()}] 🚀 SESSION CREATED -> ID: ${sessionId} | Main: "${filename}" | Language: ${language.toUpperCase()} | Files: ${fileCount}\x1b[0m`
    );
  }

  static logCompileStart(sessionId: string, cmd: string) {
    console.log(
      `\x1b[33m[EXECUTION SYSTEM] [${this.formatTime()}] ⚙️ COMPILING -> Session: ${sessionId} | Command: "${cmd}"\x1b[0m`
    );
  }

  static logCompileSuccess(sessionId: string, durationMs: number) {
    console.log(
      `\x1b[32m[EXECUTION SYSTEM] [${this.formatTime()}] ✅ COMPILATION PASSED -> Session: ${sessionId} | Duration: ${durationMs}ms\x1b[0m`
    );
  }

  static logCompileError(sessionId: string, stderr: string) {
    console.error(
      `\x1b[31m[EXECUTION SYSTEM] [${this.formatTime()}] ❌ COMPILATION FAILED -> Session: ${sessionId} | Error:\n${stderr}\x1b[0m`
    );
  }

  static logPtySpawned(sessionId: string, pid: number | undefined, cmd: string, args: string[]) {
    console.log(
      `\x1b[35m[EXECUTION SYSTEM] [${this.formatTime()}] 💻 PTY SPAWNED -> Session: ${sessionId} | PID: ${pid || 'unknown'} | Exec: "${cmd} ${args.join(' ')}"\x1b[0m`
    );
  }

  static logLimitExceeded(sessionId: string, reason: string) {
    console.warn(
      `\x1b[31m[EXECUTION SYSTEM] [${this.formatTime()}] ⚠️ LIMIT EXCEEDED -> Session: ${sessionId} | Reason: ${reason}\x1b[0m`
    );
  }

  static logProcessExit(sessionId: string, exitCode: number, totalTimeMs: number) {
    const color = exitCode === 0 ? '\x1b[32m' : '\x1b[31m';
    console.log(
      `${color}[EXECUTION SYSTEM] [${this.formatTime()}] 🏁 PROCESS EXITED -> Session: ${sessionId} | Code: ${exitCode} | Duration: ${totalTimeMs}ms\x1b[0m`
    );
  }

  static logCleanup(sessionId: string, tempDir: string) {
    console.log(
      `\x1b[90m[EXECUTION SYSTEM] [${this.formatTime()}] 🧹 CLEANUP COMPLETE -> Session: ${sessionId} | Purged: "${tempDir}"\x1b[0m`
    );
  }
}
