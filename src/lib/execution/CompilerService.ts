import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { CompilationResult, detectLanguage, SourceFile } from './types';
import { ExecutionLogger } from './ExecutionLogger';

export class CompilerService {
  static async prepareAndCompile(
    sessionId: string,
    tempDir: string,
    filename: string,
    code: string,
    files: SourceFile[] = []
  ): Promise<CompilationResult> {
    const startTime = Date.now();
    const lang = detectLanguage(filename);

    console.log(`[STAGE: 3. TEMP WORKSPACE CREATED] TempDir: "${tempDir}"`);

    // 1. Write main source file
    const mainFilePath = path.join(tempDir, filename);
    await fs.writeFile(mainFilePath, code, 'utf-8');

    // 2. Write auxiliary source files
    if (files && files.length > 0) {
      for (const f of files) {
        if (f.filename && f.filename !== filename && f.content !== undefined) {
          const auxPath = path.join(tempDir, f.filename);
          await fs.mkdir(path.dirname(auxPath), { recursive: true });
          await fs.writeFile(auxPath, f.content, 'utf-8');
        }
      }
    }

    console.log(`[STAGE: 4. FILES WRITTEN] Main file: "${filename}"`);

    const executablePath = path.join(tempDir, 'a.out');
    let compileCmd: string | null = null;
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
        const cFiles = allDirFiles.filter((f) => f.endsWith('.c')).map((f) => `"${path.join(tempDir, f)}"`);
        cFiles.push(`"${unbufferPath}"`);
        compileCmd = `gcc -O2 ${cFiles.join(' ')} -o "${executablePath}" -lm`;
      } else {
        const cppFiles = allDirFiles.filter((f) => f.endsWith('.cpp') || f.endsWith('.cc') || f.endsWith('.cxx')).map((f) => `"${path.join(tempDir, f)}"`);
        const unbufferObjPath = path.join(tempDir, '__unbuffer.o');
        // Compile unbuffer object file with gcc, then link with g++
        compileCmd = `gcc -c "${unbufferPath}" -o "${unbufferObjPath}" && g++ -O2 "${unbufferObjPath}" ${cppFiles.join(' ')} -o "${executablePath}" -std=c++17`;
      }
      runCmd = executablePath;
    } else if (lang === 'java') {
      const javaFiles = allDirFiles.filter((f) => f.endsWith('.java')).map((f) => `"${path.join(tempDir, f)}"`);
      const className = path.basename(filename, '.java');
      compileCmd = `javac ${javaFiles.join(' ')}`;
      runCmd = 'java';
      runArgs = ['-Dfile.encoding=UTF-8', '-cp', tempDir, className];
    } else if (lang === 'python') {
      runCmd = 'python3';
      runArgs = ['-u', mainFilePath];
    } else if (lang === 'javascript') {
      runCmd = 'node';
      runArgs = [mainFilePath];
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

    if (compileCmd) {
      console.log(`[STAGE: 5. COMPILER STARTED] Executing: "${compileCmd}"`);
      ExecutionLogger.logCompileStart(sessionId, compileCmd);

      const compileResult = await new Promise<{ err: Error | null; stdout: string; stderr: string }>((resolve) => {
        exec(compileCmd!, { cwd: tempDir, timeout: 15000 }, (err, stdout, stderr) => {
          resolve({ err, stdout, stderr });
        });
      });

      const compilationTimeMs = Date.now() - startTime;

      if (compileResult.err) {
        const fullErr = compileResult.stderr || compileResult.stdout || compileResult.err?.message || compileResult.err.message;
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
        stderr: compileResult.stderr || '',
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
