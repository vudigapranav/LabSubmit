// Every supported language runs end to end through the execution engine with standard input,
// and tool output never shows the server's temp directory (MVP_STABILIZATION_REPORT.md).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, prisma, tokenFor, runOnEngine } from './helpers.mjs';
import { stripTempDir } from '../src/lib/execution/CompilerService.ts';
import { parseAllowedLanguages, serializeAllowedLanguages } from '../src/lib/examTiming.ts';

const tag = `lang_${Date.now()}`;
const ua = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
const fx = {};

async function startedExam(allowedLanguages) {
  const now = Date.now();
  const lab = await prisma.lab.create({ data: { title: `${tag} ${allowedLanguages}`, description: 'd', problemStatement: 'p', year: fx.subject.year, branchId: fx.subject.branchId, subjectId: fx.subject.id, lecturerId: fx.subject.lecturerId, isPublished: true, allowedLanguages, startTime: new Date(now - 60_000), endTime: new Date(now + 3_600_000), durationMinutes: 60 } });
  await api(`/api/student/workspace?labId=${lab.id}`, { token: fx.token, headers: ua });
  const s = await api('/api/student/workspace', { token: fx.token, method: 'POST', headers: ua, body: { labId: lab.id, action: 'start_exam', sessionId: 's' } });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  return lab;
}

before(async () => {
  fx.subject = await prisma.subject.findFirst({ where: { lecturerId: { not: null } } });
  const roll = `8181${String(Date.now()).slice(-8)}`;
  fx.student = await prisma.user.create({ data: { name: `${tag} student`, role: 'STUDENT', rollNumber: roll, password: 'x', studentProfile: { create: { rollNumber: roll, year: fx.subject.year, branchId: fx.subject.branchId } } } });
  fx.token = tokenFor(fx.student);
  fx.all = await startedExam('c,cpp,java,python,javascript');
  fx.legacy = await startedExam('c,cpp,java,python');
});

after(async () => {
  const ids = (await prisma.lab.findMany({ where: { title: { startsWith: tag } } })).map((l) => l.id);
  await prisma.executionRecord.deleteMany({ where: { workspace: { labId: { in: ids } } } });
  await prisma.labWorkspace.deleteMany({ where: { labId: { in: ids } } });
  await prisma.answerSheetSection.deleteMany({ where: { labId: { in: ids } } });
  await prisma.lab.deleteMany({ where: { id: { in: ids } } });
  await prisma.studentProfile.deleteMany({ where: { userId: fx.student.id } });
  await prisma.user.delete({ where: { id: fx.student.id } });
  await prisma.$disconnect();
});

const PROGRAMS = {
  'main.c': '#include <stdio.h>\nint main(){int a,b;scanf("%d %d",&a,&b);printf("sum %d\\n",a+b);return 0;}\n',
  'main.cpp': '#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<"sum "<<a+b<<std::endl;}\n',
  'Main.java': 'import java.util.*;\npublic class Main{public static void main(String[] x){Scanner s=new Scanner(System.in);int a=s.nextInt(),b=s.nextInt();System.out.println("sum "+(a+b));}}\n',
  'main.py': 'a, b = map(int, input().split())\nprint("sum", a + b)\n',
  'main.js': 'const rl = require("readline").createInterface({ input: process.stdin });\nrl.on("line", (l) => { const [a, b] = l.split(" ").map(Number); console.log("sum", a + b); rl.close(); });\n',
};

for (const [filename, code] of Object.entries(PROGRAMS)) {
  test(`${filename}: compiles/runs with standard input`, async () => {
    const r = await runOnEngine({ token: fx.token, labId: fx.all.id, filename, code, inputs: ['20 22\r'], timeoutMs: 60000 });
    assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
    assert.equal(r.exitCode, 0, r.output);
    // Node colours numbers on a TTY; compare the text.
    assert.match(r.programOutput.replace(/\x1b\[[0-9;]*m/g, ''), /sum 42/);
  });
}

test('a compile error names the file, not the server temp directory', async () => {
  const r = await runOnEngine({ token: fx.token, labId: fx.all.id, filename: 'main.c', code: 'int main( { return 0; }\n' });
  assert.match(r.output, /main\.c:1/);
  assert.doesNotMatch(r.output, /labsubmit_exec|\/tmp\/|\/var\/folders/, r.output);
});

test('a Python runtime error traceback does not show the server temp directory', async () => {
  const r = await runOnEngine({ token: fx.token, labId: fx.all.id, filename: 'main.py', code: 'print(1/0)\n' });
  assert.notEqual(r.exitCode, 0);
  assert.match(r.output, /ZeroDivisionError/);
  assert.match(r.output.replace(/\x1b\[[0-9;]*m/g, ''), /File "main\.py"/);
  assert.doesNotMatch(r.output, /labsubmit_exec|\/tmp\/|\/var\/folders/, r.output);
});

test('JavaScript is opt-in: refused in an exam that does not allow it, for runs and new files', async () => {
  const r = await runOnEngine({ token: fx.token, labId: fx.legacy.id, filename: 'main.js', code: 'console.log("x")\n' });
  assert.ok(r.errors.length > 0, 'run refused');
  assert.doesNotMatch(r.programOutput, /^x/m);
  const created = await api('/api/student/workspace', { token: fx.token, method: 'POST', headers: ua, body: { labId: fx.legacy.id, action: 'create_file', filename: 'main.js', content: '' } });
  assert.equal(created.status, 400);
});

test('unconfigured exams keep the original four languages', () => {
  assert.deepEqual(parseAllowedLanguages(''), ['c', 'cpp', 'java', 'python']);
  assert.equal(serializeAllowedLanguages(['javascript', 'cobol']), 'javascript');
  assert.equal(serializeAllowedLanguages(['cobol']), 'c,cpp,java,python');
});

test('stripTempDir removes both spellings of a macOS temp path', () => {
  const dir = '/var/folders/x/T/labsubmit_exec_1';
  assert.equal(stripTempDir(`/private${dir}/main.c:1:5: error\n${dir}/main.c:2:1: note`, dir), 'main.c:1:5: error\nmain.c:2:1: note');
});
