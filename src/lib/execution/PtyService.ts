import * as ptyModule from 'node-pty';
import { IPty } from 'node-pty';
import { ExecutionSession } from './types';
import { ExecutionLogger } from './ExecutionLogger';
import { buildSandboxEnv, runIdentity, warnIfRunningWithoutIdentity, withResourceLimits } from './sandbox';

const pty = (ptyModule as any).default || ptyModule || require('node-pty');

export interface PtySpawnOptions {
  runCmd: string;
  runArgs: string[];
  tempDir: string;
  cols?: number;
  rows?: number;
  onData: (data: string) => void;
  onExit: (exitCode: number) => void;
}

export class PtyService {
  static spawnPty(session: ExecutionSession, options: PtySpawnOptions): IPty {
    const cols = options.cols || 80;
    const rows = options.rows || 24;


    if (typeof pty?.spawn !== 'function') {
      throw new Error(`node-pty spawn is not a function. typeof pty: ${typeof pty}, keys: ${JSON.stringify(Object.keys(pty || {}))}`);
    }

    try {
      // Minimal environment, resource limits and (when configured) an unprivileged uid —
      // see sandbox.ts. Spreading process.env here used to hand the program JWT_SECRET
      // and DATABASE_URL (SECURITY_AUDIT.md S1).
      warnIfRunningWithoutIdentity();
      const id = session.identity === undefined ? runIdentity() : session.identity;
      const limited = withResourceLimits(options.runCmd, options.runArgs, session.language, session.identity);
      const ptyProcess = pty.spawn(limited.cmd, limited.args, {
        name: 'xterm-256color',
        cols: cols,
        rows: rows,
        cwd: options.tempDir,
        env: buildSandboxEnv(options.tempDir),
        ...(id ? { uid: id.uid, gid: id.gid } : {}),
      });

      session.ptyProcess = ptyProcess;

      console.log(`[STAGE: 7. PTY SPAWNED] Exec: "${options.runCmd} ${options.runArgs.join(' ')}"`);
      console.log(`[STAGE: 8. PTY PID] PID: ${ptyProcess.pid}`);
      ExecutionLogger.logPtySpawned(session.sessionId, ptyProcess.pid, options.runCmd, options.runArgs);

      let firstDataLogged = false;

      ptyProcess.onData((data: string) => {
        if (!firstDataLogged) {
          console.log(`[STAGE: 9. FIRST STDOUT/STDERR] Chunk: ${JSON.stringify(data)}`);
          firstDataLogged = true;
        }
        options.onData(data);
      });

      ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
        const code = exitCode ?? 0;
        console.log(`[STAGE: 11. EXIT CODE] PID: ${ptyProcess.pid}, Code: ${code}`);
        options.onExit(code);
      });

      return ptyProcess;
    } catch (spawnErr: any) {
      console.error('[PTY SPAWN EXCEPTION FULL STACK]', spawnErr.stack || spawnErr);
      throw spawnErr;
    }
  }

  static writeInput(session: ExecutionSession, data: string): void {
    if (session.ptyProcess && typeof session.ptyProcess.write === 'function') {
      session.ptyProcess.write(data);
    }
  }

  static resizePty(session: ExecutionSession, cols: number, rows: number): void {
    if (session.ptyProcess && cols > 0 && rows > 0) {
      try {
        session.ptyProcess.resize(cols, rows);
      } catch (e) {}
    }
  }

  static killPty(session: ExecutionSession): void {
    if (session.ptyProcess) {
      try {
        session.ptyProcess.kill('SIGKILL');
      } catch (e) {}
    }
  }
}
