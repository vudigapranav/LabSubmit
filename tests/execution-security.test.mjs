// Execution engine security and regression tests (SECURITY_AUDIT.md S1–S4).
// Each security test is written as the actual attack, so a pass means the attack failed
// against the running engine — not that some helper returned the expected value.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lecturerWithLab, runOnEngine, prisma } from './helpers.mjs';

after(() => prisma.$disconnect());

const rand = () => Math.random().toString(36).slice(2, 10);

// ── S1: secrets must not be visible to student code ─────────────────────────────────────
test('S1: student program cannot see JWT_SECRET or DATABASE_URL in its environment', async () => {
  const { lab, token } = await lecturerWithLab('python');
  const code = [
    'import os',
    "leaked = [k for k in ('JWT_SECRET', 'DATABASE_URL') if k in os.environ]",
    "print('LEAKED:' + ','.join(leaked) if leaked else 'ENV_CLEAN')",
  ].join('\n');
  const r = await runOnEngine({ token, labId: lab.id, filename: 'main.py', code });
  assert.equal(r.exitCode, 0, `Program must actually run for this test to mean anything:\n${r.output}`);
  assert.match(r.programOutput, /ENV_CLEAN/, `Program output was: ${r.output}`);
});

test('S1: compiler process does not receive server secrets either', async () => {
  // A C program can read nothing from the compiler's env, but a malicious #include of
  // /proc/self/environ would expose the COMPILER's env in the error message.
  if (process.platform !== 'linux') return; // /proc only exists on Linux
  const { lab, token } = await lecturerWithLab('c');
  const r = await runOnEngine({ token, labId: lab.id, filename: 'main.c', code: '#include "/proc/self/environ"\nint main(){}' });
  assert.doesNotMatch(r.output, /JWT_SECRET|DATABASE_URL/);
});

// ── S2: path traversal ─────────────────────────────────────────────────────────────────
test('S2: auxiliary filename with ../ is rejected and nothing is written outside the temp dir', async () => {
  const { lab, token } = await lecturerWithLab('python');
  const name = `labsubmit_pwn_${rand()}.txt`;
  const escaped = path.join(os.tmpdir(), name); // where ../<name> would land
  const r = await runOnEngine({
    token,
    labId: lab.id,
    filename: 'main.py',
    code: 'print("hi")',
    files: [{ filename: `../${name}`, content: 'pwned' }],
  });
  assert.equal(fs.existsSync(escaped), false, `Traversal wrote ${escaped}`);
  assert.notEqual(r.exitCode, 0, 'Run with an unsafe filename should be refused');
  assert.ok(r.errors.some((e) => e.code === 'INVALID_FILENAME'), `Errors: ${JSON.stringify(r.errors)}`);
});

test('S2: main filename with a path is rejected', async () => {
  const { lab, token } = await lecturerWithLab('python');
  const name = `labsubmit_pwn_${rand()}.py`;
  const r = await runOnEngine({ token, labId: lab.id, filename: `../${name}`, code: 'print(1)' });
  assert.equal(fs.existsSync(path.join(os.tmpdir(), name)), false);
  assert.ok(r.errors.some((e) => e.code === 'INVALID_FILENAME'), `Errors: ${JSON.stringify(r.errors)}`);
});

// ── S3: shell injection through the compile command ─────────────────────────────────────
test('S3: shell metacharacters in a filename do not execute during compilation', async () => {
  const { lab, token } = await lecturerWithLab('c');
  const marker = path.join(os.tmpdir(), `labsubmit_inject_${rand()}`);
  const r = await runOnEngine({
    token,
    labId: lab.id,
    filename: 'main.c',
    code: '#include <stdio.h>\nint main(){printf("ok\\n");return 0;}',
    files: [{ filename: `x$(touch ${marker}).c`, content: 'int helper(void){return 1;}' }],
  });
  assert.equal(fs.existsSync(marker), false, 'Injected command executed');
  assert.ok(r.errors.some((e) => e.code === 'INVALID_FILENAME'), `Errors: ${JSON.stringify(r.errors)}`);
});

// ── Regression: every supported language still compiles, runs and takes stdin ──────────
test('Regression: C program with interactive stdin', async () => {
  const { lab, token } = await lecturerWithLab('c');
  const code = '#include <stdio.h>\nint main(){int n;printf("Enter n: ");scanf("%d",&n);printf("square=%d\\n",n*n);return 0;}';
  const r = await runOnEngine({ token, labId: lab.id, filename: 'main.c', code, inputs: ['7\r'] });
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.programOutput, /square=49/);
});

test('Regression: multi-file C program (helper file compiled and linked)', async () => {
  const { lab, token } = await lecturerWithLab('c');
  const r = await runOnEngine({
    token,
    labId: lab.id,
    filename: 'main.c',
    code: '#include <stdio.h>\nint helper(void);\nint main(){printf("h=%d\\n",helper());return 0;}',
    files: [{ filename: 'helper.c', content: 'int helper(void){return 42;}' }],
  });
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.programOutput, /h=42/);
});

test('Regression: C++ program', async () => {
  const { lab, token } = await lecturerWithLab('cpp');
  const code = '#include <iostream>\n#include <vector>\nint main(){std::vector<int> v{1,2,3};int s=0;for(int x:v)s+=x;std::cout<<"sum="<<s<<std::endl;}';
  const r = await runOnEngine({ token, labId: lab.id, filename: 'main.cpp', code });
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.programOutput, /sum=6/);
});

test('Regression: Java program with stdin', async () => {
  const { lab, token } = await lecturerWithLab('java');
  const code = 'import java.util.*;\npublic class Main{public static void main(String[] a){Scanner s=new Scanner(System.in);int n=s.nextInt();System.out.println("twice="+(2*n));}}';
  const r = await runOnEngine({ token, labId: lab.id, filename: 'Main.java', code, inputs: ['21\r'], timeoutMs: 45000 });
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.programOutput, /twice=42/);
});

test('Regression: Python program with stdin', async () => {
  const { lab, token } = await lecturerWithLab('python');
  const r = await runOnEngine({ token, labId: lab.id, filename: 'main.py', code: 'n=int(input("n? "))\nprint("cube", n**3)', inputs: ['3\r'] });
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.programOutput, /cube 27/);
});

test('Regression: compile errors are still reported to the student', async () => {
  const { lab, token } = await lecturerWithLab('c');
  const r = await runOnEngine({ token, labId: lab.id, filename: 'main.c', code: 'int main(){ return x; }' });
  assert.notEqual(r.exitCode, 0);
  assert.match(r.output, /Compilation Failed/);
});

// ── S4: resource limits ────────────────────────────────────────────────────────────────
test('S4: a runaway file write is stopped by the file-size limit', async () => {
  const { lab, token } = await lecturerWithLab('python');
  // Tries to write 200 MB into the temp dir; the cap is far lower.
  const code = [
    'try:',
    "    with open('big.bin','wb') as f:",
    '        for _ in range(200): f.write(b"0"*1024*1024)',
    "    print('WROTE_ALL')",
    'except Exception as e:',
    "    print('BLOCKED', type(e).__name__)",
  ].join('\n');
  const r = await runOnEngine({ token, labId: lab.id, filename: 'main.py', code });
  // Either Python reports the failed write, or the kernel kills it with SIGXFSZ — but it
  // must have actually started, or a pass would be meaningless.
  assert.match(r.output, /Program Started/, r.output);
  assert.doesNotMatch(r.programOutput, /WROTE_ALL/, r.output);
});
