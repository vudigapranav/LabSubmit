// Session recovery and deadline boundaries (security blocker items 5 and 6).
// Each test is something a student could actually try.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { api, prisma, tokenFor, WS_URL } from './helpers.mjs';

const tag = `sess_${Date.now()}`;
const headers = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
const fx = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  fx.lecturer = await prisma.user.findFirst({ where: { role: 'LECTURER' } });
});
after(async () => {
  const labs = await prisma.lab.findMany({ where: { title: { startsWith: tag } }, select: { id: true } });
  const ids = labs.map((l) => l.id);
  await prisma.submission.deleteMany({ where: { labId: { in: ids } } });
  await prisma.examViolation.deleteMany({ where: { labId: { in: ids } } });
  await prisma.labWorkspace.deleteMany({ where: { labId: { in: ids } } });
  await prisma.lab.deleteMany({ where: { id: { in: ids } } });
  const users = await prisma.user.findMany({ where: { name: { startsWith: tag } }, select: { id: true } });
  await prisma.studentProfile.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await prisma.user.deleteMany({ where: { name: { startsWith: tag } } });
  await prisma.$disconnect();
});

// An exam whose end is `endInMs` from now; the student has NOT started yet unless startedAt given.
async function exam({ endInMs = 3_600_000, durationMinutes = 60, startedAt = null } = {}) {
  const now = Date.now();
  const roll = `7171${String(now).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
  const st = await prisma.user.create({ data: { name: `${tag} ${roll}`, role: 'STUDENT', rollNumber: roll, password: 'x', studentProfile: { create: { rollNumber: roll, year: 2 } } } });
  const lab = await prisma.lab.create({
    data: { title: `${tag} ${roll}`, description: 'd', problemStatement: 'p', year: 2, lecturerId: fx.lecturer.id, isPublished: true, allowedLanguages: 'python', durationMinutes, examDate: new Date(now - 120_000), startTime: new Date(now - 120_000), endTime: new Date(now + endInMs) },
  });
  const ws = await prisma.labWorkspace.create({
    data: { labId: lab.id, studentId: st.id, startedAt, files: { create: [{ filename: 'main.py', language: 'python', content: 'v0' }] } },
    include: { files: true },
  });
  const act = (body) => api('/api/student/workspace', { token: tokenFor(st), method: 'POST', headers, body: { labId: lab.id, ...body } });
  return { st, lab, ws, file: ws.files[0], act };
}

test('restarting the browser and starting again does not restart the clock', async () => {
  const e = await exam();
  const first = await e.act({ action: 'start_exam', sessionId: 'tab-A' });
  assert.equal(first.status, 200);
  await sleep(1200);
  // New browser profile: new session id; also tries to smuggle its own start time.
  const again = await e.act({ action: 'start_exam', sessionId: 'tab-B', startedAt: new Date(Date.now() + 3_600_000).toISOString() });
  assert.equal(again.status, 200);
  assert.equal(again.json.workspace.startedAt, first.json.workspace.startedAt, 'startedAt is set once, by the server');
  assert.equal(again.json.effectiveDeadline, first.json.effectiveDeadline, 'deadline unchanged');
  // The second session is detected (logged), not given a fresh attempt.
  const hb = await api('/api/student/heartbeat', { token: tokenFor(e.st), method: 'POST', body: { labId: e.lab.id, sessionId: 'tab-B' } });
  assert.equal(hb.json.duplicateSession, true);
});

test('per-student duration: the deadline is startedAt + duration, whatever the client sends', async () => {
  const startedAt = new Date(Date.now() - 50 * 60_000);
  const e = await exam({ durationMinutes: 60, startedAt });
  const g = await api(`/api/student/workspace?labId=${e.lab.id}`, { token: tokenFor(e.st), headers });
  assert.equal(new Date(g.json.effectiveDeadline).getTime(), startedAt.getTime() + 60 * 60_000);
});

test('deadline boundary: a save just before is accepted, just after is refused and auto-submits the pre-deadline work', async () => {
  const e = await exam({ endInMs: 2500, startedAt: new Date() });
  const before = await e.act({ action: 'save_file', fileId: e.file.id, content: 'saved in time' });
  assert.equal(before.status, 200, JSON.stringify(before.json));
  await sleep(3000); // now past the deadline
  const late = await e.act({ action: 'save_file', fileId: e.file.id, content: 'too late' });
  assert.equal(late.status, 403);
  const snap = await prisma.submissionSnapshot.findFirst({ where: { submission: { labId: e.lab.id } } });
  assert.deepEqual([snap.reason, snap.onTime, snap.files[0].content], ['TIMEOUT', true, 'saved in time']);
  // A manual submit afterwards just confirms the existing hand-in.
  const submit = await e.act({ action: 'submit_lab' });
  assert.equal(submit.json.alreadySubmitted, true);
  assert.equal(await prisma.submissionSnapshot.count({ where: { submission: { labId: e.lab.id } } }), 1);
});

test('a client-supplied timestamp cannot make a late hand-in look on time', async () => {
  const e = await exam({ durationMinutes: 1, startedAt: new Date(Date.now() - 5 * 60_000) });
  const r = await e.act({ action: 'submit_lab', submittedAt: new Date(Date.now() - 10 * 60_000).toISOString(), onTime: true });
  assert.equal(r.status, 200);
  assert.equal(r.json.receipt.onTime, false);
});

test('a completed submission cannot be reopened or changed by the student', async () => {
  const e = await exam({ startedAt: new Date() });
  assert.equal((await e.act({ action: 'submit_lab' })).status, 200);
  assert.equal((await e.act({ action: 'start_exam', sessionId: 'again' })).status, 403);
  assert.equal((await e.act({ action: 'save_file', fileId: e.file.id, content: 'after submit' })).status, 403);
  assert.equal((await e.act({ action: 'create_file', filename: 'extra.py', content: '' })).status, 403);
  assert.equal((await prisma.labFile.findUnique({ where: { id: e.file.id } })).content, 'v0');
  // ...nor run code against it.
  const code = await new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, { headers });
    ws.on('open', () => ws.send(JSON.stringify({ type: 'run', filename: 'main.py', code: 'print(1)', token: tokenFor(e.st), labId: e.lab.id })));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'error') {
        ws.close();
        resolve(m.code);
      }
    });
    ws.on('error', reject);
  });
  assert.equal(code, 'ALREADY_SUBMITTED');
});

test('"needs correction" after the deadline reopens nothing the student can use (no extension)', async () => {
  const e = await exam({ durationMinutes: 1, startedAt: new Date(Date.now() - 5 * 60_000) });
  assert.equal((await e.act({ action: 'submit_lab' })).status, 200);
  const sub = await prisma.submission.findFirst({ where: { labId: e.lab.id } });
  await api('/api/lecturer/evaluate', { token: tokenFor(fx.lecturer), method: 'POST', body: { submissionId: sub.id, status: 'NEEDS_CORRECTION', isPublished: false } });
  const save = await e.act({ action: 'save_file', fileId: e.file.id, content: 'sneaky edit' });
  assert.equal(save.status, 403, 'the deadline still applies after a reopen');
  assert.equal((await prisma.labFile.findUnique({ where: { id: e.file.id } })).content, 'v0');
});

test('two sessions editing the same file: the stale one is refused, not applied', async () => {
  const e = await exam({ startedAt: new Date() });
  const base = e.file.updatedAt.toISOString();
  const tabA = await e.act({ action: 'save_file', fileId: e.file.id, content: 'from tab A', baseUpdatedAt: base });
  assert.equal(tabA.status, 200);
  const tabB = await e.act({ action: 'save_file', fileId: e.file.id, content: 'from tab B (stale)', baseUpdatedAt: base });
  assert.equal(tabB.status, 409);
  assert.equal((await prisma.labFile.findUnique({ where: { id: e.file.id } })).content, 'from tab A');
});
