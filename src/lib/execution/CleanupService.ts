import fs from 'fs/promises';
import { ExecutionSession } from './types';
import { ExecutionLogger } from './ExecutionLogger';

export class CleanupService {
  static async cleanupSession(session: ExecutionSession): Promise<void> {
    if (session.isCleaningUp) return;
    session.isCleaningUp = true;

    if (session.timeoutTimer) {
      clearTimeout(session.timeoutTimer);
      session.timeoutTimer = null;
    }

    if (session.ptyProcess) {
      try {
        session.ptyProcess.kill('SIGKILL');
      } catch (e) {}
      session.ptyProcess = null;
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
