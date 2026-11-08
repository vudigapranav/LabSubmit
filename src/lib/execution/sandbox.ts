// What a student program is allowed to inherit from the execution host, and the limits it
// runs under. Every compile and run goes through here so the policy lives in one place.
//
// This is containment, not a sandbox. See SECURITY_AUDIT.md S4 for what it does and does
// not achieve; a real isolation boundary (namespaces / per-run container) is still owed.
import path from 'path';
import fs from 'fs/promises';
import type { SupportedLanguage } from './types';

// ── Environment ─────────────────────────────────────────────────────────────────────────
// Built from an allow-list, never by copying process.env. Copying the server environment
// handed JWT_SECRET and DATABASE_URL to every student program (S1): one print() of
// os.environ was enough to forge an ADMIN token.
export function buildSandboxEnv(tempDir: string): Record<string, string> {
  const env: Record<string, string> = {
    // PATH is needed to find java/python3/node; it is not secret.
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: tempDir,
    TMPDIR: tempDir,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TERM: 'xterm-256color',
    PYTHONUNBUFFERED: '1',
    PYTHONDONTWRITEBYTECODE: '1',
  };
  if (process.env.JAVA_HOME) env.JAVA_HOME = process.env.JAVA_HOME;
  return env;
}

// ── Resource limits ────────────────────────────────────────────────────────────────────
// Applied with the shell's `ulimit` builtin in a tiny wrapper, then `exec "$@"` replaces
// the wrapper with the real program. The program and its arguments are passed as
// positional parameters, never interpolated into the script, so nothing the student
// controls is ever parsed by the shell.
export const RESOURCE_LIMITS = {
  // CPU seconds. A blocked read() costs no CPU, so interactive programs are unaffected;
  // this catches spin loops and anything forked into the background that would otherwise
  // outlive the PTY (the wall-clock guard only kills the PTY's own process).
  cpuSeconds: 30,
  // Max size of any single file written, in ulimit blocks (512 B or 1 KiB depending on the
  // shell — so 20–40 MB). Stops a program filling the host disk.
  fileSizeBlocks: 40960,
  // Virtual memory in KiB for native code and Python. Not applied to Java: the JVM
  // reserves far more address space than it uses and fails to start under -v; it is
  // bounded with -Xmx instead (see JAVA_HEAP_FLAGS).
  virtualMemoryKb: 512 * 1024,
};

export const JAVA_HEAP_FLAGS = ['-Xmx256m', '-Xss8m', '-XX:+UseSerialGC'];

const LIMITED_MEMORY_LANGUAGES: SupportedLanguage[] = ['c', 'cpp', 'python'];

export function withResourceLimits(
  cmd: string,
  args: string[],
  language: SupportedLanguage | 'compile'
): { cmd: string; args: string[] } {
  const lines = [
    `ulimit -t ${RESOURCE_LIMITS.cpuSeconds} 2>/dev/null`,
    `ulimit -f ${RESOURCE_LIMITS.fileSizeBlocks} 2>/dev/null`,
  ];
  // macOS does not support RLIMIT_AS; the `2>/dev/null` lets local development run without
  // it. The Linux execution host enforces it.
  if (language !== 'compile' && LIMITED_MEMORY_LANGUAGES.includes(language)) {
    lines.push(`ulimit -v ${RESOURCE_LIMITS.virtualMemoryKb} 2>/dev/null`);
  }
  lines.push('exec "$@"');
  // `labsubmit-run` becomes $0; the real command and its args become "$@".
  return { cmd: '/bin/sh', args: ['-c', lines.join('; '), 'labsubmit-run', cmd, ...args] };
}

// ── Privilege drop ─────────────────────────────────────────────────────────────────────
// When the server runs as root (the Docker image does) and EXEC_RUN_UID/EXEC_RUN_GID name
// an unprivileged account, compile and run as that account. This is what actually keeps
// secrets away on Linux: an env scrub alone still lets a same-uid process read
// /proc/<server-pid>/environ, and signal (kill) the server itself.
export function runIdentity(): { uid: number; gid: number } | null {
  const uid = Number(process.env.EXEC_RUN_UID);
  const gid = Number(process.env.EXEC_RUN_GID);
  if (!Number.isInteger(uid) || !Number.isInteger(gid) || uid <= 0 || gid <= 0) return null;
  // Changing uid requires root; outside root (local dev) the option would make every spawn
  // fail, so it is ignored there rather than breaking execution.
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return null;
  return { uid, gid };
}

let warnedNoIdentity = false;
export function warnIfRunningWithoutIdentity(): void {
  if (warnedNoIdentity || runIdentity()) return;
  warnedNoIdentity = true;
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '[SECURITY] Student code is running as the server user. Set EXEC_RUN_UID/EXEC_RUN_GID ' +
        '(and run the server as root) to drop privileges — see docs/SECURITY_AUDIT.md S4.'
    );
  }
}

// Hands the run's temp dir to the unprivileged account so it can write a.out / .class
// files there, and closes it to everyone else.
export async function prepareTempDirOwnership(tempDir: string): Promise<void> {
  const id = runIdentity();
  if (!id) return;
  await fs.chown(tempDir, id.uid, id.gid);
  await fs.chmod(tempDir, 0o700);
}

// Defence in depth behind isSafeSourceFilename(): the resolved path must sit directly
// inside the run's temp dir.
export function resolveInsideTempDir(tempDir: string, filename: string): string {
  const root = path.resolve(tempDir);
  const resolved = path.resolve(root, filename);
  if (path.dirname(resolved) !== root) {
    throw new Error(`Refusing to write outside the execution directory: ${filename}`);
  }
  return resolved;
}
