import { ExecutionSession } from './types';
import { CleanupService } from './CleanupService';

export class SessionManager {
  private static sessions = new Map<string, ExecutionSession>();

  static register(session: ExecutionSession): void {
    this.sessions.set(session.sessionId, session);
  }

  static get(sessionId: string): ExecutionSession | undefined {
    return this.sessions.get(sessionId);
  }

  static async remove(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);
      await CleanupService.cleanupSession(session);
    }
  }

  static async cleanupAll(): Promise<void> {
    const activeSessions = Array.from(this.sessions.values());
    this.sessions.clear();
    for (const session of activeSessions) {
      await CleanupService.cleanupSession(session);
    }
  }
}

if (typeof process !== 'undefined') {
  process.on('exit', () => {
    SessionManager.cleanupAll().catch(() => {});
  });
}
