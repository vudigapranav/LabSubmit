// Lecturer submission review (docs/SUBMISSION_REVIEW_REPORT.md): every student run records the
// exact source it compiled; the review API returns the hand-in, never the live workspace; and a
// Lecturer Test Run executes the stored hand-in server-side without touching the student's
// history or the snapshot's integrity.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, prisma, tokenFor, runOnEngine } from './helpers.mjs';
import { compareRunSource } from '../src/lib/runTranscript.ts';
import { runSourceForRecord, RECORD_SOURCE_LIMIT } from '../src/lib/executionRecords.ts';

const tag = `review_${Date.now()}`;
const ua = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
const fx = { students: [] };

// The student's program: reads two lines, uses a helper module (multi-file hand-in).
const HELPER_PY = 'def greet(name):\n    return "hello " + name\n';
const MAIN_PY = 'from helper import greet\nname = input("name? ")\nn = int(input("n? "))\nprint(greet(name))\nprint("square", n * n)\n';

async function sitExam(label) {
  const roll = `6262${String(Date.now()).slice(-6)}${fx.students.length}`;
  const student = await prisma.user.create({
    data: { name: `${tag} ${label}`, role: 'STUDENT', rollNumber: roll, password: 'x', studentProfile: { create: { rollNumber: roll, year: 2 } } },
  });
  fx.students.push(student);
  const token = tokenFor(student);
  await api(`/api/student/workspace?labId=${fx.lab.id}`, { token, headers: ua });
  const s = await api('/api/student/workspace', { token, method: 'POST', headers: ua, body: { labId: fx.lab.id, action: 'start_exam', sessionId: 's' } });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  const ws = await prisma.labWorkspace.findFirst({ where: { labId: fx.lab.id, studentId: student.id } });
  // Replace the starter files with this student's program, as the editor's saves would.
  await prisma.labFile.deleteMany({ where: { workspaceId: ws.id } });
  return { student, token, ws };
}

async function setFiles(ws, files) {
  await prisma.labFile.deleteMany({ where: { workspaceId: ws.id } });
  for (const f of files) await prisma.labFile.create({ data: { workspaceId: ws.id, ...f } });
}

async function submit(s) {
  const r = await api('/api/student/workspace', { token: s.token, method: 'POST', headers: ua, body: { labId: fx.lab.id, action: 'submit_lab' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return prisma.submission.findFirst({ where: { workspaceId: s.ws.id } });
}

async function recordsFor(ws, expected) {
  for (let i = 0; i < 40; i++) {
    const rows = await prisma.executionRecord.findMany({ where: { workspaceId: ws.id }, orderBy: { createdAt: 'asc' } });
    if (rows.length >= expected) return rows;
    await new Promise((r) => setTimeout(r, 100));
  }
  return prisma.executionRecord.findMany({ where: { workspaceId: ws.id }, orderBy: { createdAt: 'asc' } });
}

const reviewRun = (token, submissionId, filename, extra = {}) =>
  runOnEngine({ token, labId: fx.lab.id, filename, code: 'print("NOT THE HAND-IN")', files: [{ filename, content: 'print("NOT THE HAND-IN")' }], submissionId, ...extra });

before(async () => {
  const lecturers = await prisma.user.findMany({ where: { role: 'LECTURER' }, take: 2, orderBy: { createdAt: 'asc' } });
  [fx.owner, fx.otherLecturer] = lecturers;
  fx.ownerToken = tokenFor(fx.owner);
  const now = Date.now();
  fx.lab = await prisma.lab.create({
    data: {
      title: `${tag} exam`, description: 'review fixture', problemStatement: 'greet and square', year: 2,
      lecturerId: fx.owner.id, isPublished: true, allowedLanguages: 'c,cpp,java,python,javascript',
      startTime: new Date(now - 60_000), endTime: new Date(now + 3_600_000), durationMinutes: 60,
    },
  });
  fx.otherLab = await prisma.lab.create({
    data: { title: `${tag} other`, description: 'd', problemStatement: 'p', year: 2, lecturerId: fx.owner.id, isPublished: false },
  });
});

after(async () => {
  const labIds = [fx.lab.id, fx.otherLab.id];
  const wsIds = (await prisma.labWorkspace.findMany({ where: { labId: { in: labIds } } })).map((w) => w.id);
  await prisma.submissionSnapshot.deleteMany({ where: { submission: { labId: { in: labIds } } } });
  await prisma.submission.deleteMany({ where: { labId: { in: labIds } } });
  await prisma.executionRecord.deleteMany({ where: { workspaceId: { in: wsIds } } });
  await prisma.labWorkspace.deleteMany({ where: { labId: { in: labIds } } });
  await prisma.examViolation.deleteMany({ where: { labId: { in: labIds } } });
  await prisma.lab.deleteMany({ where: { id: { in: labIds } } });
  for (const s of fx.students) {
    await prisma.studentProfile.deleteMany({ where: { userId: s.id } });
    await prisma.user.delete({ where: { id: s.id } });
  }
  await prisma.$disconnect();
});

// ── The Python acceptance scenario, end to end through the real engine ─────────────────────
test('two Python runs with different input are recorded with stdin, output and the exact source', async () => {
  const s = (fx.py = await sitExam('python'));
  const files = [{ filename: 'helper.py', content: HELPER_PY }, { filename: 'main.py', content: MAIN_PY }];
  const run = (name, n) =>
    runOnEngine({
      token: s.token, labId: fx.lab.id, filename: 'main.py', code: MAIN_PY, files,
      inputs: [{ after: /name\? $/, data: `${name}\r` }, { after: /n\? $/, data: `${n}\r` }],
    });
  const a = await run('asha', 3);
  assert.equal(a.exitCode, 0, a.output);
  const b = await run('ravi', 12);
  assert.equal(b.exitCode, 0, b.output);
  // A runtime error from a later edit — and the hand-in is the corrected program again.
  const broken = MAIN_PY.replace('n * n', 'n / 0');
  const c = await runOnEngine({ token: s.token, labId: fx.lab.id, filename: 'main.py', code: broken, files, inputs: [{ after: /name\? $/, data: 'x\r' }, { after: /n\? $/, data: '1\r' }] });
  assert.notEqual(c.exitCode, 0);

  const rows = await recordsFor(s.ws, 3);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].stdin, 'asha\n3\n');
  assert.match(rows[0].stdout, /hello asha\nsquare 9/);
  assert.equal(rows[1].stdin, 'ravi\n12\n');
  assert.match(rows[1].stdout, /hello ravi\nsquare 144/);
  assert.match(rows[2].stdout, /ZeroDivisionError/);
  assert.doesNotMatch(rows[2].stdout, /labsubmit_exec|\/tmp\/|\/var\/folders/);
  // The source each run compiled: both files, the entry file as it was at that run.
  assert.deepEqual(rows[0].files, [
    { filename: 'helper.py', language: 'python', content: HELPER_PY },
    { filename: 'main.py', language: 'python', content: MAIN_PY },
  ]);
  assert.equal(rows[2].files.find((f) => f.filename === 'main.py').content, broken);

  await setFiles(s.ws, [{ filename: 'helper.py', content: HELPER_PY, language: 'python' }, { filename: 'main.py', content: MAIN_PY, language: 'python' }]);
  fx.pySub = await submit(s);
});

test('the review API returns the hand-in files and every run with its source; runs say whether they ran the hand-in', async () => {
  const list = await api(`/api/lecturer/submissions?labId=${fx.lab.id}`, { token: fx.ownerToken });
  assert.equal(list.status, 200);
  const sub = list.json.submissions.find((x) => x.id === fx.pySub.id);
  assert.deepEqual(sub.files.map((f) => [f.filename, f.language, f.content]), [['helper.py', 'python', HELPER_PY], ['main.py', 'python', MAIN_PY]]);
  assert.equal(sub.snapshots[0].verified, true, 'integrity verified');

  const runs = await api(`/api/lecturer/executions?submissionId=${fx.pySub.id}`, { token: fx.ownerToken });
  assert.equal(runs.status, 200);
  assert.equal(runs.json.runs.length, 3);
  const [latest, second, first] = runs.json.runs; // newest first
  assert.equal(first.stdin, 'asha\n3\n');
  assert.equal(second.stdin, 'ravi\n12\n');
  assert.equal(compareRunSource(first.files, sub.files), 'same');
  assert.equal(compareRunSource(latest.files, sub.files), 'different', 'the runtime-error run used edited code');
  assert.equal(latest.exitCode, 1);
});

test('the review shows the hand-in even after the live workspace changes (e.g. reopened for correction)', async () => {
  await prisma.labFile.updateMany({ where: { workspaceId: fx.py.ws.id, filename: 'main.py' }, data: { content: 'print("edited after submission")\n' } });
  const list = await api(`/api/lecturer/submissions?labId=${fx.lab.id}`, { token: fx.ownerToken });
  const sub = list.json.submissions.find((x) => x.id === fx.pySub.id);
  assert.equal(sub.files.find((f) => f.filename === 'main.py').content, MAIN_PY);
  assert.equal(sub.snapshots[0].verified, true);
});

// ── Lecturer Test Run ────────────────────────────────────────────────────────────────────
test('a Lecturer Test Run executes the stored hand-in, not code sent by the browser, and is labelled', async () => {
  const r = await reviewRun(fx.ownerToken, fx.pySub.id, 'main.py', { inputs: [{ after: /name\? $/, data: 'lect\r' }, { after: /n\? $/, data: '5\r' }] });
  assert.equal(r.exitCode, 0, r.output);
  assert.match(r.output, /Lecturer Test Run of main\.py from hand-in v1\. Not part of the student's record\./);
  assert.match(r.programOutput, /hello lect/);
  assert.match(r.programOutput, /square 25/);
  assert.doesNotMatch(r.output, /NOT THE HAND-IN|edited after submission/, 'neither browser code nor the live workspace ran');
});

test("a Lecturer Test Run changes neither the student's run history nor the hand-in", async () => {
  const runsBefore = await prisma.executionRecord.findMany({ where: { workspaceId: fx.py.ws.id }, orderBy: { createdAt: 'asc' } });
  const snapBefore = await prisma.submissionSnapshot.findMany({ where: { submissionId: fx.pySub.id } });
  const totalBefore = await prisma.executionRecord.count();

  const r = await reviewRun(fx.ownerToken, fx.pySub.id, 'main.py', { inputs: [{ after: /name\? $/, data: 'q\r' }, { after: /n\? $/, data: '2\r' }] });
  assert.equal(r.exitCode, 0, r.output);
  await new Promise((res) => setTimeout(res, 600));

  assert.deepEqual(await prisma.executionRecord.findMany({ where: { workspaceId: fx.py.ws.id }, orderBy: { createdAt: 'asc' } }), runsBefore);
  assert.equal(await prisma.executionRecord.count(), totalBefore, 'no record anywhere');
  assert.deepEqual(await prisma.submissionSnapshot.findMany({ where: { submissionId: fx.pySub.id } }), snapBefore);
  const list = await api(`/api/lecturer/submissions?labId=${fx.lab.id}`, { token: fx.ownerToken });
  assert.equal(list.json.submissions.find((x) => x.id === fx.pySub.id).snapshots[0].verified, true);
});

test('a Lecturer Test Run is refused for a file not in the hand-in, another exam, or another lecturer', async () => {
  const notIn = await reviewRun(fx.ownerToken, fx.pySub.id, 'other.py');
  assert.equal(notIn.errors[0]?.code, 'NOT_IN_SUBMISSION');
  assert.doesNotMatch(notIn.output, /NOT THE HAND-IN/);

  const wrongLab = await runOnEngine({ token: fx.ownerToken, labId: fx.otherLab.id, filename: 'main.py', code: 'print(1)', submissionId: fx.pySub.id });
  assert.equal(wrongLab.errors[0]?.code, 'NOT_FOUND', 'a submission id is only valid under its own exam');

  if (fx.otherLecturer) {
    const other = await reviewRun(tokenFor(fx.otherLecturer), fx.pySub.id, 'main.py');
    assert.equal(other.errors[0]?.code, 'FORBIDDEN');
  }
});

test('a student cannot use submissionId to run anything after submitting', async () => {
  const r = await reviewRun(fx.py.token, fx.pySub.id, 'main.py');
  assert.equal(r.errors[0]?.code, 'ALREADY_SUBMITTED');
});

// ── Other languages, a compile error ─────────────────────────────────────────────────────
const LANGS = [
  { label: 'C', filename: 'main.c', language: 'c', content: '#include <stdio.h>\nint main(){int a;scanf("%d",&a);printf("twice %d\\n",a*2);return 0;}\n' },
  { label: 'C++', filename: 'main.cpp', language: 'cpp', content: '#include <iostream>\nint main(){int a;std::cin>>a;std::cout<<"twice "<<a*2<<std::endl;}\n' },
  { label: 'Java', filename: 'Main.java', language: 'java', content: 'import java.util.*;\npublic class Main{public static void main(String[] x){int a=new Scanner(System.in).nextInt();System.out.println("twice "+(a*2));}}\n' },
  { label: 'JavaScript', filename: 'main.js', language: 'javascript', content: 'const rl=require("readline").createInterface({input:process.stdin});rl.on("line",(l)=>{console.log("twice",Number(l)*2);rl.close();});\n' },
];

for (const L of LANGS) {
  test(`${L.label}: the run is recorded with its source, and a Lecturer Test Run reruns the hand-in`, async () => {
    const s = await sitExam(L.label);
    const r = await runOnEngine({ token: s.token, labId: fx.lab.id, filename: L.filename, code: L.content, files: [{ filename: L.filename, content: L.content }], inputs: ['21\r'], timeoutMs: 60000 });
    assert.equal(r.exitCode, 0, r.output);
    const [rec] = await recordsFor(s.ws, 1);
    assert.equal(rec.stdin, '21\n');
    assert.match(stripColour(rec.stdout), /twice 42/);
    assert.deepEqual(rec.files, [{ filename: L.filename, language: L.language, content: L.content }]);

    await setFiles(s.ws, [{ filename: L.filename, content: L.content, language: L.language }]);
    const sub = await submit(s);
    const t = await reviewRun(fx.ownerToken, sub.id, L.filename, { inputs: ['8\r'], timeoutMs: 60000 });
    assert.equal(t.exitCode, 0, t.output);
    assert.match(stripColour(t.programOutput), /twice 16/);
    assert.equal((await recordsFor(s.ws, 1)).length, 1, 'the test run added nothing to the history');
  });
}

test('a compile error is recorded with its diagnostics and source, and the test run shows the same error', async () => {
  const s = await sitExam('compile-error');
  const bad = '#include <stdio.h>\nint main(){ printf("x") return 0; }\n';
  const r = await runOnEngine({ token: s.token, labId: fx.lab.id, filename: 'main.c', code: bad, files: [{ filename: 'main.c', content: bad }] });
  assert.equal(r.exitCode, 1);
  const [rec] = await recordsFor(s.ws, 1);
  assert.equal(rec.compileFailed, true);
  assert.match(rec.stdout, /main\.c:2/);
  assert.equal(rec.files[0].content, bad);

  await setFiles(s.ws, [{ filename: 'main.c', content: bad, language: 'c' }]);
  const sub = await submit(s);
  const t = await reviewRun(fx.ownerToken, sub.id, 'main.c');
  assert.equal(t.exitCode, 1);
  assert.match(t.output, /Compilation Failed/);
  assert.match(t.output, /main\.c:2/);
});

// ── Pure rules ───────────────────────────────────────────────────────────────────────────
test('run source is kept whole or not at all, in canonical order', () => {
  assert.deepEqual(runSourceForRecord([{ filename: 'b.py', language: 'python', content: '2' }, { filename: 'a.py', language: 'python', content: '1' }]).map((f) => f.filename), ['a.py', 'b.py']);
  assert.equal(runSourceForRecord([{ filename: 'big.py', language: 'python', content: 'x'.repeat(RECORD_SOURCE_LIMIT + 1) }]), null);
});

test('compareRunSource is exact and never guesses for unrecorded source', () => {
  const h = [{ filename: 'a.py', content: 'print(1)' }];
  assert.equal(compareRunSource(null, h), 'unknown');
  assert.equal(compareRunSource([{ filename: 'a.py', content: 'print(1)' }], h), 'same');
  assert.equal(compareRunSource([{ filename: 'a.py', content: 'print(1) ' }], h), 'different');
  assert.equal(compareRunSource([...h, { filename: 'b.py', content: '' }], h), 'different');
});

function stripColour(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}
