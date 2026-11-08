// Execution isolation through the FULL path: WebSocket → server.js → ExecutionController →
// per-run uid pool + seccomp launcher, in the production Docker image (security blocker item 1).
//
// Runs only against a deployment configured for isolation:
//   LABSUBMIT_EXPECT_ISOLATION=1 LABSUBMIT_BASE_URL=http://localhost:3400 DATABASE_URL=... npm test
// Skipped otherwise (a local macOS dev server is not isolated by design).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, tokenFor, runOnEngine } from './helpers.mjs';

const enabled = process.env.LABSUBMIT_EXPECT_ISOLATION === '1';
const opts = { skip: enabled ? false : 'set LABSUBMIT_EXPECT_ISOLATION=1 and point LABSUBMIT_BASE_URL at an isolated deployment' };
const tag = `iso_${Date.now()}`;
const fx = {};

before(async () => {
  if (!enabled) return;
  const lect = await prisma.user.findFirst({ where: { role: 'LECTURER' } });
  const now = Date.now();
  fx.lab = await prisma.lab.create({ data: { title: `${tag} exam`, description: 'd', problemStatement: 'p', year: 2, lecturerId: lect.id, isPublished: true, allowedLanguages: 'c,java,python', durationMinutes: 60, examDate: new Date(now - 60000), startTime: new Date(now - 60000), endTime: new Date(now + 3600000) } });
  fx.students = [];
  for (const s of ['1', '2']) {
    const roll = `5151${String(now).slice(-7)}${s}`;
    const st = await prisma.user.create({ data: { name: `${tag} ${s}`, role: 'STUDENT', rollNumber: roll, password: 'x', studentProfile: { create: { rollNumber: roll, year: 2 } } } });
    await prisma.labWorkspace.create({ data: { labId: fx.lab.id, studentId: st.id, startedAt: new Date() } });
    fx.students.push(st);
  }
});
after(async () => {
  if (enabled && fx.lab) {
    await prisma.executionRecord.deleteMany({ where: { workspace: { labId: fx.lab.id } } });
    await prisma.labWorkspace.deleteMany({ where: { labId: fx.lab.id } });
    await prisma.lab.delete({ where: { id: fx.lab.id } });
    const ids = fx.students.map((s) => s.id);
    await prisma.studentProfile.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.$disconnect();
});

const run = (student, code, filename = 'main.py') => runOnEngine({ token: tokenFor(student), labId: fx.lab.id, filename, code, timeoutMs: 45000 });

const PROBE = [
  'import os, socket',
  'print("UID", os.getuid())',
  'try:',
  '    socket.socket(socket.AF_INET, socket.SOCK_STREAM); print("NET open")',
  'except Exception as e: print("NET", type(e).__name__)',
  'try:',
  '    d = open("/proc/%d/environ" % os.getppid(), "rb").read(); print("PROCENV", b"JWT_SECRET" in d or b"INTEGRITY_KEY" in d)',
  'except Exception as e: print("PROCENV", type(e).__name__)',
  'try:',
  '    os.kill(os.getppid(), 0); print("SIGNAL allowed")',
  'except Exception as e: print("SIGNAL", type(e).__name__)',
  'print("ENV", sorted(k for k in os.environ if k in ("JWT_SECRET","DATABASE_URL","INTEGRITY_KEY")))',
].join('\n');

test('a student program runs as a pooled uid with no network, no server env and no way to signal the server', opts, async () => {
  const r = await run(fx.students[0], PROBE);
  assert.equal(r.exitCode, 0, r.output);
  const out = r.programOutput;
  const uid = Number((out.match(/UID (\d+)/) || [])[1]);
  assert.ok(uid >= 20000 && uid <= 20099, `uid ${uid}`);
  assert.match(out, /NET PermissionError/);
  assert.match(out, /PROCENV PermissionError/);
  assert.match(out, /SIGNAL PermissionError/);
  assert.match(out, /ENV \[\]/);
});

test('two students running at the same time get different uids', opts, async () => {
  const slow = 'import os, time\nprint("UID", os.getuid())\ntime.sleep(2)';
  const [a, b] = await Promise.all([run(fx.students[0], slow), run(fx.students[1], slow)]);
  const ua = (a.programOutput.match(/UID (\d+)/) || [])[1];
  const ub = (b.programOutput.match(/UID (\d+)/) || [])[1];
  assert.ok(ua && ub && ua !== ub, `uids ${ua} / ${ub}`);
});

test('compiled languages still work inside the sandbox (C, Java)', opts, async () => {
  const c = await run(fx.students[0], '#include <stdio.h>\nint main(){printf("c-ok\\n");return 0;}', 'main.c');
  assert.match(c.programOutput, /c-ok/, c.output);
  const j = await run(fx.students[0], 'public class Main{public static void main(String[] a){System.out.println("java-ok");}}', 'Main.java');
  assert.match(j.programOutput, /java-ok/, j.output);
});
