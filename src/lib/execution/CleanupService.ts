import fs from 'fs/promises';
import { ExecutionSession } from './types';
import { ExecutionLogger } from './ExecutionLogger';
import { reapRunIdentity } from './sandbox';

export class CleanupService {
  static async cleanupSession(session: ExecutionSession): Promise<void> {
    if (session.isCleaningUp) return;
    session.isCleaningUp = true;

    if (session.timeoutTimer) {
      clearTimeout(session.timeoutTimer);
      session.timeoutTimer = null;
    }

    if (session.ptyProcess) {
      // Kill the whole process group, not just the program. node-pty starts the program as a
      // session leader, so its pid is the group id; children it started (including ones that
      // ignore SIGHUP) are in that group and would otherwise outlive the run (S16). A child
      // that calls setsid() leaves the group — only a real sandbox contains that (S4).
      try {
        process.kill(-session.ptyProcess.pid, 'SIGKILL');
      } catch (e) {}
      try {
        session.ptyProcess.kill('SIGKILL');
      } catch (e) {}
      session.ptyProcess = null;
    }

    // A pooled uid belongs to this run alone: kill everything it owns (including children
    // that escaped the process group with setsid) and return it to the pool.
    if (session.identity?.pooled) {
      await reapRunIdentity(session.identity);
    }

    if (session.tempDir) {
      try {
        await fs.rm(session.tempDir, { recursive: true, force: true });
        console.log(`[STAGE: 12. CLEANUP] TempDir purged: "${session.tempDir}"`);
        ExecutionLogger.logCleanup(session.sessionId, session.tempDir);
      } catch (e: any) {
        console.error(`[CleanupService] Error removing tempDir "${session.tempDir}":`, e.message);
      }
    }
  }
}
