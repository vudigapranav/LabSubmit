import { ExecutionLimits, DEFAULT_EXECUTION_LIMITS, ExecutionSession } from './types';
import { ExecutionLogger } from './ExecutionLogger';

export class RuntimeSandbox {
  static setupTimeoutGuard(
    session: ExecutionSession,
    onTimeout: (reason: string) => void,
    limits: ExecutionLimits = DEFAULT_EXECUTION_LIMITS
  ): NodeJS.Timeout {
    return setTimeout(() => {
      ExecutionLogger.logLimitExceeded(session.sessionId, `Runtime limit of ${limits.timeoutMs}ms exceeded`);
      onTimeout(`\r\n\x1b[33m[Execution Time Limit Reached (max ${limits.timeoutMs / 1000}s active runtime)]\x1b[0m\r\n`);
    }, limits.timeoutMs);
  }

  static checkOutputLimit(
    session: ExecutionSession,
    chunkLength: number,
    onLimitExceeded: (reason: string) => void,
    limits: ExecutionLimits = DEFAULT_EXECUTION_LIMITS
  ): boolean {
    session.outputByteCount += chunkLength;
    if (session.outputByteCount > limits.maxOutputBytes) {
      ExecutionLogger.logLimitExceeded(session.sessionId, `Output size limit of ${limits.maxOutputBytes} bytes exceeded`);
      onLimitExceeded(`\r\n\x1b[33m[Execution Output Size Limit Exceeded (max 5MB buffer cap)]\x1b[0m\r\n`);
      return true;
    }
    return false;
  }
}
