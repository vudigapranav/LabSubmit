import { CompilerService } from './execution/CompilerService';
import { detectLanguage, CodeExecutionRequest, CodeExecutionResult } from './execution/types';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

export { detectLanguage };
export type { CodeExecutionRequest, CodeExecutionResult };

export async function executeCode(req: {
  filename: string;
  code: string;
  stdin?: string;
  files?: { filename: string; content: string }[];
}): Promise<{
  success: boolean;
  stdout: string;
  stderr: string;
  compilationError: boolean;
  executionTimeMs: number;
  exitCode: number | null;
  language: string;
}> {
  const startTime = Date.now();
  const lang = detectLanguage(req.filename);
  const tempDir = path.join(os.tmpdir(), `labsubmit_batch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  await fs.mkdir(tempDir, { recursive: true });

  try {
    const compileResult = await CompilerService.prepareAndCompile(
      `batch_${Date.now()}`,
      tempDir,
      req.filename,
      req.code,
      req.files || []
    );

    if (!compileResult.success) {
      return {
        success: false,
        stdout: compileResult.stdout,
        stderr: compileResult.stderr,
        compilationError: true,
        executionTimeMs: compileResult.compilationTimeMs,
        exitCode: 1,
        language: lang,
      };
    }

    return {
      success: true,
      stdout: compileResult.stdout,
      stderr: compileResult.stderr,
      compilationError: false,
      executionTimeMs: Date.now() - startTime,
      exitCode: 0,
      language: lang,
    };
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (e) {}
  }
}
