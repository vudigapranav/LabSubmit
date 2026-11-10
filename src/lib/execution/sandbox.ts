// What a student program is allowed to inherit from the execution host, and the limits it
// runs under. Every compile and run goes through here so the policy lives in one place.
//
// This is containment, not a sandbox. See SECURITY_AUDIT.md S4 for what it does and does
// not achieve; a real isolation boundary (namespaces / per-run container) is still owed.
import path from 'path';
import fs from 'fs/promises';
import { accessSync, constants as fsConstants } from 'fs';
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

// Node, like the JVM, reserves far more address space than it uses and will not start under
// `ulimit -v`, so its heap is bounded with V8's own flag instead.
export const NODE_HEAP_FLAGS = ['--max-old-space-size=256'];

const LIMITED_MEMORY_LANGUAGES: SupportedLanguage[] = ['c', 'cpp', 'python'];

export function withResourceLimits(
  cmd: string,
  args: string[],
  language: SupportedLanguage | 'compile',
  identity?: { pooled: boolean } | null
): { cmd: string; args: string[] } {
  const lines = [
    // Files the program creates are private to its uid unless it deliberately chmods them.
    'umask 077',
    `ulimit -t ${RESOURCE_LIMITS.cpuSeconds} 2>/dev/null`,
    `ulimit -f ${RESOURCE_LIMITS.fileSizeBlocks} 2>/dev/null`,
  ];
  // macOS does not support RLIMIT_AS; the `2>/dev/null` lets local development run without
  // it. The Linux execution host enforces it.
  if (language !== 'compile' && LIMITED_MEMORY_LANGUAGES.includes(language)) {
    lines.push(`ulimit -v ${RESOURCE_LIMITS.virtualMemoryKb} 2>/dev/null`);
  }
  // The seccomp launcher (sandbox-launcher.c) sits between the shell and the program: no
  // network, no ptrace/mount/unshare/io_uring, and it fails closed if the filter cannot be
  // installed. Passed as a positional argument like everything else — never interpolated.
  const launcher = sandboxLauncher();
  // Only safe with a per-run uid: RLIMIT_NPROC counts every process of the uid, so under a
  // shared uid it would be a limit shared by all students (and, without a uid drop, by the
  // server itself).
  if (identity?.pooled) lines.push(`ulimit -u ${PER_RUN_PROCESS_LIMIT} 2>/dev/null`);
  lines.push('exec "$@"');
  // `labsubmit-run` becomes $0; the real command and its args become "$@".
  return { cmd: '/bin/sh', args: ['-c', lines.join('; '), 'labsubmit-run', ...(launcher ? [launcher] : []), cmd, ...args] };
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
export async function prepareTempDirOwnership(tempDir: string, identity?: RunIdentity | null): Promise<void> {
  const id = identity === undefined ? runIdentity() : identity;
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

// ── Per-run identity pool (EXEC_RUN_UID_RANGE) ─────────────────────────────────────────
// With one shared runner uid (EXEC_RUN_UID), every concurrent run is the same OS user, so
// one student's program can read another's live files, a process-count limit is shared by
// everyone, and a child that leaves its process group (setsid) cannot be found again.
// Verified on Linux in the security assessment (COMPILER_SECURITY_REVIEW.md, P7/P9/P11).
// Giving each concurrent run its OWN uid fixes all three inside the existing engine:
//   - run directories are 0700 and owned by different uids → mutually unreadable;
//   - `ulimit -u` counts only that run's processes → a real fork-bomb cap;
//   - cleanup kills every process owned by the uid, wherever it went.
// Linux needs no /etc/passwd entry to switch to a numeric uid, so the pool needs no image
// changes beyond running the server as root. Network isolation still needs a real sandbox.

export interface RunIdentity {
  uid: number;
  gid: number;
  /** True when the uid belongs to this run alone (pool mode). */
  pooled: boolean;
}

/** Processes (incl. threads) one pooled run may have. The JVM alone uses ~20 threads. */
export const PER_RUN_PROCESS_LIMIT = 128;

function parseRange(value: string | undefined): [number, number] | null {
  const m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(value || '');
  if (!m) return null;
  const [lo, hi] = [Number(m[1]), Number(m[2])];
  return lo > 0 && hi >= lo && hi - lo < 10000 ? [lo, hi] : null;
}

// Kept on globalThis, not in module scope: if this module is ever loaded twice (two loaders,
// two bundles), module-scoped state would split into two pools — one acquiring, another
// releasing — and every uid would leak until the pool was exhausted and all runs refused.
// Observed under tsx's ESM loader during testing; server.js's CJS path was not affected.
const POOL_KEY = '__labsubmitRunUidsInUse';
const uidsInUse: Set<number> = ((globalThis as Record<string, unknown>)[POOL_KEY] as Set<number>) ??
  ((globalThis as Record<string, unknown>)[POOL_KEY] = new Set<number>());

/**
 * The identity a new run executes as: a pooled uid when EXEC_RUN_UID_RANGE is configured,
 * else the single shared EXEC_RUN_UID, else null (run as the server user — local dev).
 * Returns 'EXHAUSTED' when every pooled uid is busy; the run must then be refused rather
 * than share a uid.
 */
export function acquireRunIdentity(): RunIdentity | null | 'EXHAUSTED' {
  const range = parseRange(process.env.EXEC_RUN_UID_RANGE);
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  if (range && isRoot) {
    for (let uid = range[0]; uid <= range[1]; uid++) {
      if (!uidsInUse.has(uid)) {
        uidsInUse.add(uid);
        return { uid, gid: uid, pooled: true };
      }
    }
    return 'EXHAUSTED';
  }
  const single = runIdentity();
  return single ? { ...single, pooled: false } : null;
}

/** Real uid of every process currently in /proc (Linux). Empty where /proc is absent. */
async function processesOwnedBy(uid: number): Promise<number[]> {
  let entries: string[];
  try {
    entries = await fs.readdir('/proc');
  } catch {
    return [];
  }
  const pids: number[] = [];
  for (const e of entries) {
    if (!/^\d+$/.test(e)) continue;
    try {
      const status = await fs.readFile(`/proc/${e}/status`, 'utf8');
      const m = /^Uid:\s+(\d+)/m.exec(status);
      if (m && Number(m[1]) === uid) pids.push(Number(e));
    } catch {
      // process exited while we looked
    }
  }
  return pids;
}

/**
 * Kills everything the pooled uid owns, removes what it left in /tmp, and returns the uid
 * to the pool. Repeats the kill because a forking program can create processes while we
 * work; the per-run process limit keeps that bounded.
 */
export async function reapRunIdentity(identity: RunIdentity): Promise<void> {
  if (!identity.pooled) return;
  try {
    for (let round = 0; round < 10; round++) {
      const pids = await processesOwnedBy(identity.uid);
      if (pids.length === 0) break;
      for (const pid of pids) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {}
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    // Files the run dropped outside its own directory (e.g. /tmp/x).
    for (const name of await fs.readdir('/tmp').catch(() => [] as string[])) {
      const p = path.join('/tmp', name);
      try {
        const st = await fs.lstat(p);
        if (st.uid === identity.uid) await fs.rm(p, { recursive: true, force: true });
      } catch {}
    }
  } finally {
    // Release only after the uid owns nothing, so the next run cannot inherit its processes.
    if ((await processesOwnedBy(identity.uid)).length === 0) uidsInUse.delete(identity.uid);
    else console.error(`[SECURITY] uid ${identity.uid} still owns processes after reaping; leaving it out of the pool.`);
  }
}

// ── Seccomp launcher (EXEC_SANDBOX_LAUNCHER) ───────────────────────────────────────────
// Path to the compiled sandbox-launcher.c (the Dockerfile builds it). Checked once; an entry
// that is not an executable file is treated as absent.
let launcherCache: string | null | undefined;
export function sandboxLauncher(): string | null {
  if (launcherCache !== undefined) return launcherCache;
  const p = process.env.EXEC_SANDBOX_LAUNCHER;
  launcherCache = null;
  if (p) {
    try {
      accessSync(p, fsConstants.X_OK);
      launcherCache = p;
    } catch {
      console.error(`[SECURITY] EXEC_SANDBOX_LAUNCHER=${p} is not an executable file; student code is NOT network-isolated.`);
    }
  }
  return launcherCache;
}

/**
 * EXEC_REQUIRE_SANDBOX=true makes isolation mandatory: with no usable launcher, or no per-run
 * uid pool, runs are refused rather than executed unisolated. Off by default so a deployment
 * without the launcher keeps working; production should turn it on (see
 * docs/SECURITY_BLOCKER_CLOSURE_REPORT.md).
 */
export function sandboxRefusal(): string | null {
  if (process.env.EXEC_REQUIRE_SANDBOX !== 'true') return null;
  if (!sandboxLauncher()) return 'Code execution is unavailable: the execution sandbox is not installed on this server.';
  const range = parseRange(process.env.EXEC_RUN_UID_RANGE);
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  if (!range || !isRoot) return 'Code execution is unavailable: per-run isolation is not configured on this server.';
  return null;
}

/** One line for the startup log describing the isolation actually in force. */
export function describeIsolation(): string {
  const range = parseRange(process.env.EXEC_RUN_UID_RANGE);
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const identity = range && isRoot ? `per-run uid ${range[0]}-${range[1]}` : runIdentity() ? 'single runner uid' : 'server uid (NOT isolated)';
  return `identity=${identity}; network/syscall filter=${sandboxLauncher() ? 'seccomp launcher' : 'NONE'}; required=${process.env.EXEC_REQUIRE_SANDBOX === 'true'}`;
}
