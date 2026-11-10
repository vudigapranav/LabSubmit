import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { CompilationResult, detectLanguage, SourceFile } from './types';
import { ExecutionLogger } from './ExecutionLogger';
import { isSafeSourceFilename, SOURCE_FILENAME_RULE } from '../sourceFilename';
import {
  buildSandboxEnv,
  JAVA_HEAP_FLAGS,
  NODE_HEAP_FLAGS,
  prepareTempDirOwnership,
  resolveInsideTempDir,
  runIdentity,
  withResourceLimits,
  type RunIdentity,
} from './sandbox';

/** Removes the run's temp directory from tool output, leaving bare file names. */
export function stripTempDir(text: string, tempDir: string): string {
  if (!text || !tempDir) return text;
  const dir = tempDir.endsWith(path.sep) ? tempDir : tempDir + path.sep;
  // macOS reports /var/folders/... as /private/var/folders/...; strip both spellings.
  // The longer spelling must go first, or stripping the shorter one leaves a stray '/private'.
  return text.split('/private' + dir).join('').split(dir).join('');
}

// One compiler invocation: an executable and its argument list. Never a shell string —
// the old `exec("gcc \"${file}\" ...")` let a filename containing $(...) run shell (S3).
type CompileStep = { cmd: string; args: string[] };

function runCompileStep(
  step: CompileStep,
  tempDir: string,
  identity: RunIdentity | null | undefined
): Promise<{ err: Error | null; stdout: string; stderr: string }> {
  const id = identity === undefined ? runIdentity() : identity;
  const limited = withResourceLimits(step.cmd, step.args, 'compile', identity);
  return new Promise((resolve) => {
    execFile(
      limited.cmd,
      limited.args,
      {
        cwd: tempDir,
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        // Deliberately minimal (no NODE_ENV either); the cast only satisfies Next's ProcessEnv typing.
        env: buildSandboxEnv(tempDir) as unknown as NodeJS.ProcessEnv,
        ...(id ? { uid: id.uid, gid: id.gid } : {}),
      },
      (err, stdout, stderr) => resolve({ err, stdout: String(stdout), stderr: String(stderr) })
    );
  });
}

export class CompilerService {
  static async prepareAndCompile(
    sessionId: string,
    tempDir: string,
    filename: string,
    code: string,
    files: SourceFile[] = [],
    // The run's identity, chosen by the controller. Undefined = legacy single-uid behaviour
    // (lib/compiler.ts); null = run as the server user.
    identity?: RunIdentity | null
  ): Promise<CompilationResult> {
    const startTime = Date.now();
    const lang = detectLanguage(filename);

    // The controller validates names before calling us; this re-check keeps the service
    // safe for any other caller (lib/compiler.ts uses it too).
    const unsafe = [filename, ...files.map((f) => f.filename)].find((n) => !isSafeSourceFilename(n));
    if (unsafe !== undefined) {
      return {
        success: false,
        compileCmd: null,
        stdout: '',
        stderr: `Invalid file name "${String(unsafe)}". ${SOURCE_FILENAME_RULE}`,
        compilationTimeMs: Date.now() - startTime,
        mainFilePath: '',
        runCmd: '',
        runArgs: [],
      };
    }

    console.log(`[STAGE: 3. TEMP WORKSPACE CREATED] TempDir: "${tempDir}"`);
    await prepareTempDirOwnership(tempDir, identity);

    // 1. Write main source file
    const mainFilePath = resolveInsideTempDir(tempDir, filename);
    await fs.writeFile(mainFilePath, code, 'utf-8');

    // 2. Write auxiliary source files (flat: names are single path segments)
    for (const f of files) {
      if (f.filename !== filename && typeof f.content === 'string') {
        await fs.writeFile(resolveInsideTempDir(tempDir, f.filename), f.content, 'utf-8');
      }
    }

    console.log(`[STAGE: 4. FILES WRITTEN] Main file: "${filename}"`);

    const executablePath = path.join(tempDir, 'a.out');
    let compileSteps: CompileStep[] = [];
    let runCmd = '';
    let runArgs: string[] = [];

    // Collect all workspace files for multi-file compilation
    const allDirFiles = await fs.readdir(tempDir);

    if (lang === 'c' || lang === 'cpp') {
      // Inject unbuffer constructor to flush stdout/stderr immediately for prompt-based interactive C/C++ programs
      const unbufferPath = path.join(tempDir, '__unbuffer.c');
      const unbufferCode = `#include <stdio.h>\n__attribute__((constructor)) void __labsubmit_unbuffer(void) { setvbuf(stdout, NULL, _IONBF, 0); setvbuf(stderr, NULL, _IONBF, 0); }\n`;
      await fs.writeFile(unbufferPath, unbufferCode, 'utf-8');

      if (lang === 'c') {
        const cFiles = allDirFiles.filter((f) => f.endsWith('.c')).map((f) => path.join(tempDir, f));
        cFiles.push(unbufferPath);
        compileSteps = [{ cmd: 'gcc', args: ['-O2', ...cFiles, '-o', executablePath, '-lm'] }];
      } else {
        const cppFiles = allDirFiles
          .filter((f) => f.endsWith('.cpp') || f.endsWith('.cc') || f.endsWith('.cxx'))
          .map((f) => path.join(tempDir, f));
        const unbufferObjPath = path.join(tempDir, '__unbuffer.o');
        // Compile unbuffer object file with gcc, then link with g++
        compileSteps = [
          { cmd: 'gcc', args: ['-c', unbufferPath, '-o', unbufferObjPath] },
          { cmd: 'g++', args: ['-O2', unbufferObjPath, ...cppFiles, '-o', executablePath, '-std=c++17'] },
        ];
      }
      runCmd = executablePath;
    } else if (lang === 'java') {
      const javaFiles = allDirFiles.filter((f) => f.endsWith('.java')).map((f) => path.join(tempDir, f));
      const className = path.basename(filename, '.java');
      compileSteps = [{ cmd: 'javac', args: ['-J-Xmx256m', ...javaFiles] }];
      runCmd = 'java';
      runArgs = [...JAVA_HEAP_FLAGS, '-Dfile.encoding=UTF-8', '-cp', tempDir, className];
    } else if (lang === 'python') {
      runCmd = 'python3';
      // Relative to the run's cwd (the temp dir), so a traceback says `File "main.py"` rather
      // than printing the server's temp path to the student.
      runArgs = ['-u', filename];
    } else if (lang === 'javascript') {
      runCmd = 'node';
      runArgs = [...NODE_HEAP_FLAGS, `./${filename}`];
    } else {
      return {
        success: false,
        compileCmd: null,
        stdout: '',
        stderr: `Unsupported file extension "${path.extname(filename)}". Supported extensions: .c, .cpp, .java, .py, .js`,
        compilationTimeMs: Date.now() - startTime,
        mainFilePath,
        runCmd: '',
        runArgs: [],
      };
    }

    if (compileSteps.length > 0) {
      // Human-readable form for logs and the result object only — never executed as a string.
      const compileCmd = compileSteps.map((s) => [s.cmd, ...s.args].join(' ')).join(' && ');
      console.log(`[STAGE: 5. COMPILER STARTED] Executing: "${compileCmd}"`);
      ExecutionLogger.logCompileStart(sessionId, compileCmd);

      let compileResult = { err: null as Error | null, stdout: '', stderr: '' };
      for (const step of compileSteps) {
        const r = await runCompileStep(step, tempDir, identity);
        compileResult = { err: r.err, stdout: compileResult.stdout + r.stdout, stderr: compileResult.stderr + r.stderr };
        if (r.err) break;
      }

      const compilationTimeMs = Date.now() - startTime;

      if (compileResult.err) {
        // Compilers print the absolute path of every file; the student needs `main.c:3:5`, not
        // the server's temp directory.
        const fullErr = stripTempDir(compileResult.stderr || compileResult.stdout || compileResult.err?.message || compileResult.err.message, tempDir);
        console.error(`[STAGE: 6. COMPILER FINISHED - FAILED] Error:\n${fullErr}`);
        ExecutionLogger.logCompileError(sessionId, fullErr);
        return {
          success: false,
          compileCmd,
          stdout: compileResult.stdout || '',
          stderr: fullErr,
          compilationTimeMs,
          mainFilePath,
          executablePath,
          runCmd,
          runArgs,
        };
      }

      console.log(`[STAGE: 6. COMPILER FINISHED - SUCCESS] Duration: ${compilationTimeMs}ms`);
      ExecutionLogger.logCompileSuccess(sessionId, compilationTimeMs);
      return {
        success: true,
        compileCmd,
        stdout: compileResult.stdout || '',
        stderr: stripTempDir(compileResult.stderr || '', tempDir),
        compilationTimeMs,
        mainFilePath,
        executablePath,
        runCmd,
        runArgs,
      };
    }

    console.log(`[STAGE: 5 & 6. NO COMPILATION REQUIRED] Direct execution for ${lang}`);
    return {
      success: true,
      compileCmd: null,
      stdout: '',
      stderr: '',
      compilationTimeMs: Date.now() - startTime,
      mainFilePath,
      runCmd,
      runArgs,
    };
  }
}
