import WebSocket from 'ws';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import {
  ExecutionSession,
  WsClientMessage,
  WsServerMessage,
  detectLanguage,
} from './types';
import { SessionManager } from './SessionManager';
import { CompilerService } from './CompilerService';
import { RuntimeSandbox } from './RuntimeSandbox';
import { PtyService } from './PtyService';
import { ExecutionLogger } from './ExecutionLogger';
import { isSafeSourceFilename, SOURCE_FILENAME_RULE, MAX_FILES_PER_WORKSPACE } from '../sourceFilename';
import { appendBounded, applyTerminalInput, RECORD_FIELD_LIMIT, stripAnsi } from '../runTranscript';
import { persistExecutionRecord } from '../executionRecords';
import { acquireRunIdentity, sandboxRefusal } from './sandbox';
// Relative imports (not the @/* alias) — this file is loaded by server.js via tsx's
// CJS require hook, a different resolution path than Next's own webpack/SWC bundling
// used everywhere else in the app, so path-alias resolution here is unverified.
import { verifyToken } from '../jwt';
import { prisma } from '../db';
import { getExamStatus, getEffectiveDeadline, isLanguageAllowed } from '../examTiming';
import { finalizeSubmission } from '../examSubmission';
import {
  evaluateDeviceEligibility,
  headerReaderFromNodeHeaders,
  readDeviceSignals,
} from '../deviceEligibility';

// Generous for any lab program; bounds what one run can write to the execution host's disk.
const MAX_FILES_PER_RUN = MAX_FILES_PER_WORKSPACE;
// Per user, across all their sockets. Opening many sockets used to mean many parallel
// compiles and programs — a cheap way for one student to starve everyone else (S15).
// Two allows a run in the IDE plus one in another tab without enabling a pile-up.
export const MAX_CONCURRENT_RUNS_PER_USER = 2;
const MAX_SOURCE_BYTES_PER_RUN = 1024 * 1024;

// What is being captured for the run in progress. Only student runs inside their own
// workspace are recorded; a lecturer testing code in the inspector is not student history.
interface RunCapture {
  sessionId: string;
  workspaceId: string;
  filename: string;
  language: string;
  startTime: number;
  stdin: string;
  stdout: string;
  finalized: boolean;
}

type RunAuthorization = { code: string; message: string } | { workspaceId: string | null; userId: string };

export class ExecutionController {
  private ws: WebSocket;
  private requestHeaders: Record<string, string | string[] | undefined> | undefined;
  private currentSessionId: string | null = null;
  private currentRun: RunCapture | null = null;

  constructor(ws: WebSocket, requestHeaders?: Record<string, string | string[] | undefined>) {
    this.ws = ws;
    this.requestHeaders = requestHeaders;
  }

  private sendWs(message: WsServerMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message));
      } catch (e) {
        console.error('[ExecutionController] Failed to send WebSocket message:', e);
      }
    }
  }

  public async handleMessage(rawMessage: string | Buffer): Promise<void> {
    try {
      const msg: WsClientMessage = JSON.parse(rawMessage.toString());

      if (msg.type === 'run') {
        console.log(`[STAGE: 1. EXECUTION CONTROLLER INVOKED] Filename: "${msg.filename}"`);
        await this.handleRun(msg);
      } else if (msg.type === 'input') {
        this.handleInput(msg.data);
      } else if (msg.type === 'resize') {
        this.handleResize(msg.cols, msg.rows);
      } else if (msg.type === 'stop') {
        await this.handleStop();
      }
    } catch (err: any) {
      console.error('[ExecutionController] Error handling client message:', err.message);
    }
  }

  /**
   * Closes the capture for `sessionId` and persists it — exactly once. Every way a run can
   * end calls this; the session-id match stops a late onExit from a killed process being
   * recorded against (or as) the next run.
   */
  private finalizeRun(sessionId: string, outcome: { exitCode: number | null; compileFailed?: boolean; stdout?: string }): void {
    const run = this.currentRun;
    if (!run || run.sessionId !== sessionId || run.finalized) return;
    run.finalized = true;
    this.currentRun = null;
    // Not awaited: the student's terminal must not wait on the database.
    void persistExecutionRecord(prisma, {
      workspaceId: run.workspaceId,
      filename: run.filename,
      language: run.language,
      stdin: run.stdin,
      stdout: outcome.stdout ?? run.stdout,
      exitCode: outcome.exitCode,
      durationMs: Date.now() - run.startTime,
      compileFailed: outcome.compileFailed ?? false,
    });
  }

  private async handleRun(msg: Extract<WsClientMessage, { type: 'run' }>): Promise<void> {
    // 1. Clean up any previous session running on this socket
    if (this.currentSessionId) {
      // Replaced by a new run before it ended: record what it did, with no exit code.
      this.finalizeRun(this.currentSessionId, { exitCode: null });
      await SessionManager.remove(this.currentSessionId);
      this.currentSessionId = null;
    }

    const { filename, code, files = [], cols = 80, rows = 24, token, labId } = msg;

    if (!filename || code === undefined) {
      this.sendWs({ type: 'output', data: '\r\n\x1b[31mError: Filename and code content are required.\x1b[0m\r\n', system: true });
      this.sendWs({ type: 'exit', exitCode: 1, executionTimeMs: 0 });
      return;
    }

    // Every name here comes from the client, not the database, and becomes a filesystem
    // path and a compiler argument. Reject the whole run on any unsafe name — before
    // authorisation, before the temp dir exists, before anything touches the disk (S2/S3).
    const fileList = Array.isArray(files) ? files : [];
    const badName = [filename, ...fileList.map((f) => f?.filename)].find((n) => !isSafeSourceFilename(n));
    if (badName !== undefined || fileList.length > MAX_FILES_PER_RUN || fileList.some((f) => typeof f?.content !== 'string')) {
      const message =
        badName !== undefined
          ? `Invalid file name "${String(badName).slice(0, 100)}". ${SOURCE_FILENAME_RULE}`
          : 'Invalid file list.';
      this.sendWs({ type: 'error', code: 'INVALID_FILENAME', message });
      this.sendWs({ type: 'output', data: `\r\n\x1b[31m${message}\x1b[0m\r\n`, system: true });
      this.sendWs({ type: 'exit', exitCode: 1, executionTimeMs: 0 });
      return;
    }
    const totalBytes = [code, ...fileList.map((f) => f.content)].reduce((n, c) => n + Buffer.byteLength(String(c)), 0);
    if (totalBytes > MAX_SOURCE_BYTES_PER_RUN) {
      const message = `Source too large (${Math.ceil(totalBytes / 1024)} KB; limit ${MAX_SOURCE_BYTES_PER_RUN / 1024} KB).`;
      this.sendWs({ type: 'error', code: 'SOURCE_TOO_LARGE', message });
      this.sendWs({ type: 'exit', exitCode: 1, executionTimeMs: 0 });
      return;
    }

    // Authorization: verify identity, workspace ownership, and exam window before
    // touching the filesystem or spawning any process. This is the actual security
    // boundary for code execution — everything the client sends is otherwise untrusted.
    const auth = await this.authorizeRun(token, labId, filename, msg.deviceClass);
    if ('code' in auth) {
      this.sendWs({ type: 'error', code: auth.code, message: auth.message });
      this.sendWs({ type: 'exit', exitCode: 1, executionTimeMs: 0 });
      return;
    }

    // Checked and claimed in the same tick (no await in between), so parallel sockets
    // cannot all pass the check before any of them registers.
    if (SessionManager.activeFor(auth.userId) >= MAX_CONCURRENT_RUNS_PER_USER) {
      this.sendWs({
        type: 'error',
        code: 'TOO_MANY_RUNS',
        message: `You already have ${MAX_CONCURRENT_RUNS_PER_USER} programs running. Stop one before starting another.`,
      });
      this.sendWs({ type: 'exit', exitCode: 1, executionTimeMs: 0 });
      return;
    }

    // Fail closed when isolation is mandatory but not available on this host.
    const isolationProblem = sandboxRefusal();
    if (isolationProblem) {
      this.sendWs({ type: 'error', code: 'SANDBOX_UNAVAILABLE', message: isolationProblem });
      this.sendWs({ type: 'exit', exitCode: 1, executionTimeMs: 0 });
      return;
    }

    // Claimed in the same tick as the slot check and registration below (no await between).
    const identity = acquireRunIdentity();
    if (identity === 'EXHAUSTED') {
      this.sendWs({ type: 'error', code: 'HOST_BUSY', message: 'The execution server is at capacity. Please try again in a few seconds.' });
      this.sendWs({ type: 'exit', exitCode: 1, executionTimeMs: 0 });
      return;
    }

    const sessionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.currentSessionId = sessionId;
    this.currentRun = auth.workspaceId
      ? {
          sessionId,
          workspaceId: auth.workspaceId,
          filename,
          language: detectLanguage(filename),
          startTime: Date.now(),
          stdin: '',
          stdout: '',
          finalized: false,
        }
      : null;

    console.log(`[STAGE: 2. SESSION CREATED] Session ID: ${sessionId}`);

    const lang = detectLanguage(filename);
    const tempDir = path.join(os.tmpdir(), `labsubmit_exec_${sessionId}`);

    const session: ExecutionSession = {
      sessionId,
      language: lang,
      tempDir,
      filename,
      startTime: Date.now(),
      ptyProcess: null,
      timeoutTimer: null,
      outputByteCount: 0,
      isCleaningUp: false,
      ownerId: auth.userId,
      identity,
    };

    // Registered before the first await so the run-slot claim above is atomic.
    SessionManager.register(session);
    await fs.mkdir(tempDir, { recursive: true });
    ExecutionLogger.logSessionStart(sessionId, filename, lang, (files?.length || 0) + 1);

    // 2. Compilation Stage
    this.sendWs({ type: 'status', status: 'compiling' });

    const compileResult = await CompilerService.prepareAndCompile(sessionId, tempDir, filename, code, fileList, identity);

    if (!compileResult.success) {
      // The compiler's diagnostics are what this run produced; the evaluator should see them.
      this.finalizeRun(sessionId, { exitCode: 1, compileFailed: true, stdout: stripAnsi(compileResult.stderr) });
      this.sendWs({
        type: 'output',
        data: `\r\n\x1b[31mCompilation Failed:\r\n${compileResult.stderr.replace(/\n/g, '\r\n')}\x1b[0m\r\n`,
        system: true,
      });
      this.sendWs({ type: 'exit', exitCode: 1, executionTimeMs: compileResult.compilationTimeMs });
      await SessionManager.remove(sessionId);
      this.currentSessionId = null;
      return;
    }

    if (compileResult.compileCmd) {
      this.sendWs({ type: 'output', data: '\x1b[32mCompilation Successful.\x1b[0m\r\n', system: true });
    }

    // 3. Runtime Stage
    this.sendWs({ type: 'status', status: 'running' });
    this.sendWs({ type: 'output', data: '\x1b[32mProgram Started.\x1b[0m\r\n\r\n', system: true });

    // Set up runtime timeout limit guard
    session.timeoutTimer = RuntimeSandbox.setupTimeoutGuard(session, async (reasonMessage) => {
      this.finalizeRun(sessionId, { exitCode: 124 });
      this.sendWs({ type: 'output', data: reasonMessage, system: true });
      this.sendWs({ type: 'exit', exitCode: 124, executionTimeMs: Date.now() - session.startTime });
      await SessionManager.remove(sessionId);
      this.currentSessionId = null;
    });

    try {
      PtyService.spawnPty(session, {
        runCmd: compileResult.runCmd,
        runArgs: compileResult.runArgs,
        tempDir,
        cols,
        rows,
        onData: (data) => {
          const exceeded = RuntimeSandbox.checkOutputLimit(session, data.length, async (limitMessage) => {
            this.finalizeRun(sessionId, { exitCode: 137 });
            this.sendWs({ type: 'output', data: limitMessage, system: true });
            this.sendWs({ type: 'exit', exitCode: 137, executionTimeMs: Date.now() - session.startTime });
            await SessionManager.remove(sessionId);
            this.currentSessionId = null;
          });

          if (!exceeded) {
            // Same transformation the browser terminal applies, so a recorded run and an
            // Output section filled with "Use last run" compare equal.
            if (this.currentRun?.sessionId === sessionId) {
              this.currentRun.stdout = appendBounded(this.currentRun.stdout, stripAnsi(data));
            }
            this.sendWs({ type: 'output', data });
          }
        },
        onExit: (exitCode) => {
          // 100ms grace period allowing pending PTY buffer chunks to flush to onData
          setTimeout(async () => {
            const executionTimeMs = Date.now() - session.startTime;
            if (exitCode === 0) {
              this.sendWs({
                type: 'output',
                data: `\r\n\x1b[32m✓ Program Finished. (Exit Code 0, Execution Time: ${executionTimeMs}ms)\x1b[0m\r\n`,
                system: true,
              });
            } else {
              this.sendWs({
                type: 'output',
                data: `\r\n\x1b[31m⚠ Program Exited with Code ${exitCode} (Execution Time: ${executionTimeMs}ms)\x1b[0m\r\n`,
                system: true,
              });
            }

            ExecutionLogger.logProcessExit(sessionId, exitCode, executionTimeMs);
            this.finalizeRun(sessionId, { exitCode });
            this.sendWs({ type: 'exit', exitCode, executionTimeMs });

            await SessionManager.remove(sessionId);
            if (this.currentSessionId === sessionId) {
              this.currentSessionId = null;
            }
          }, 100);
        },
      });
    } catch (spawnErr: any) {
      console.error(`[ExecutionController FULL STACK ERROR]`, spawnErr.stack || spawnErr);
      this.finalizeRun(sessionId, { exitCode: null });
      this.sendWs({ type: 'output', data: `\r\n\x1b[31mExecution Error: ${spawnErr.message || spawnErr}\x1b[0m\r\n`, system: true });
      this.sendWs({ type: 'exit', exitCode: 1, executionTimeMs: Date.now() - session.startTime });
      await SessionManager.remove(sessionId);
      this.currentSessionId = null;
    }
  }

  private async authorizeRun(
    token: string | undefined,
    labId: string | undefined,
    filename: string,
    deviceClassHint?: string
  ): Promise<RunAuthorization> {
    if (!token || !labId) {
      return { code: 'UNAUTHORIZED', message: 'Missing authentication or exam context.' };
    }

    const payload = verifyToken(token);
    if (!payload) {
      return { code: 'UNAUTHORIZED', message: 'Invalid or expired session. Please log in again.' };
    }

    const lab = await prisma.lab.findUnique({ where: { id: labId } });
    if (!lab) {
      return { code: 'NOT_FOUND', message: 'Exam not found.' };
    }

    // Faculty (LECTURER/ADMIN) run code to review/test a student's submission via the
    // Submission Inspector — a pre-existing UI path, not tied to any student's own exam
    // attempt. No workspace/exam-window/deadline applies; only lab ownership matters.
    if (payload.role === 'LECTURER' || payload.role === 'ADMIN') {
      if (payload.role === 'LECTURER' && lab.lecturerId !== payload.userId) {
        return { code: 'FORBIDDEN', message: 'You do not have access to this exam.' };
      }
      return { workspaceId: null, userId: payload.userId };
    }

    if (payload.role !== 'STUDENT') {
      return { code: 'UNAUTHORIZED', message: 'Invalid or expired session. Please log in again.' };
    }

    // Exam-device restriction, from the WebSocket upgrade's own headers — the same rule
    // the REST layer applies, enforced again here because this socket is a separate entry
    // point into the same attempt.
    const device = evaluateDeviceEligibility(
      readDeviceSignals(headerReaderFromNodeHeaders(this.requestHeaders), deviceClassHint),
      { requireDesktopDevice: lab.requireDesktopDevice, phase: 'CONTINUE' }
    );
    if (!device.eligible) {
      return { code: 'DEVICE_NOT_ELIGIBLE', message: device.reason };
    }

    const workspace = await prisma.labWorkspace.findFirst({
      where: { labId, studentId: payload.userId },
    });
    if (!workspace) {
      return { code: 'NOT_FOUND', message: 'Exam workspace not found.' };
    }

    if (workspace.isSubmitted) {
      return { code: 'ALREADY_SUBMITTED', message: 'This exam has already been submitted. Editor is locked.' };
    }

    const status = getExamStatus(lab);
    if (status !== 'RUNNING') {
      return { code: 'EXAM_NOT_ACTIVE', message: `This exam is not currently active (status: ${status}).` };
    }

    const deadline = getEffectiveDeadline(lab, workspace);
    if (deadline && new Date() > deadline) {
      await finalizeSubmission(prisma, { workspaceId: workspace.id, labId, studentId: payload.userId, auto: true, reason: 'TIMEOUT' });
      return { code: 'TIME_EXPIRED', message: 'Exam time has expired. Your work has been auto-submitted.' };
    }

    const language = detectLanguage(filename);
    if (!isLanguageAllowed(lab, language)) {
      return { code: 'LANGUAGE_NOT_ALLOWED', message: `Language "${language}" is not permitted for this exam.` };
    }

    return { workspaceId: workspace.id, userId: payload.userId };
  }

  private handleInput(data: string): void {
    if (!this.currentSessionId) return;
    const session = SessionManager.get(this.currentSessionId);
    if (session) {
      PtyService.writeInput(session, data);
      if (this.currentRun?.sessionId === this.currentSessionId && this.currentRun.stdin.length < RECORD_FIELD_LIMIT) {
        this.currentRun.stdin = applyTerminalInput(this.currentRun.stdin, String(data));
      }
    }
  }

  private handleResize(cols: number, rows: number): void {
    if (!this.currentSessionId) return;
    const session = SessionManager.get(this.currentSessionId);
    if (session) {
      PtyService.resizePty(session, cols, rows);
    }
  }

  public async handleStop(): Promise<void> {
    if (!this.currentSessionId) return;
    const sessionId = this.currentSessionId;
    const session = SessionManager.get(sessionId);

    if (session) {
      this.finalizeRun(sessionId, { exitCode: null });
      PtyService.killPty(session);
      this.sendWs({ type: 'output', data: '\r\n\x1b[33m[Process terminated manually (SIGKILL)]\x1b[0m\r\n', system: true });
      this.sendWs({ type: 'exit', exitCode: 137, executionTimeMs: 0 });
      await SessionManager.remove(sessionId);
    }

    this.currentSessionId = null;
  }

  public async handleDisconnect(): Promise<void> {
    if (this.currentSessionId) {
      this.finalizeRun(this.currentSessionId, { exitCode: null });
      await SessionManager.remove(this.currentSessionId);
      this.currentSessionId = null;
    }
  }
}
