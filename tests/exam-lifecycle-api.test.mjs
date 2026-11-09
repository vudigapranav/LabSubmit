// Exam lifecycle through the real APIs (EXAM_LIFECYCLE_BUG_REPORT.md): validation on save,
// both dashboards, student entry, execution, refresh, submission and refusal after expiry.
// Uses short real windows (seconds), not hours; the hour-scale cases are covered with a
// frozen clock in exam-lifecycle.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, prisma, tokenFor, runOnEngine } from './helpers.mjs';

const tag = `lifeapi_${Date.now()}`;
const ua = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
const fx = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const iso = (d) => new Date(d).toISOString();

before(async () => {
  fx.subject = await prisma.subject.findFirst({ where: { lecturerId: { not: null } }, include: { lecturer: true } });
  fx.lect = tokenFor(fx.subject.lecturer);
  const roll = `3131${String(Date.now()).slice(-8)}`;
  fx.student = await prisma.user.create({ data: { name: `${tag} student`, role: 'STUDENT', rollNumber: roll, password: 'x', studentProfile: { create: { rollNumber: roll, year: fx.subject.year, branchId: fx.subject.branchId } } } });
  fx.stu = tokenFor(fx.student);
});
after(async () => {
  const labs = await prisma.lab.findMany({ where: { title: { startsWith: tag } }, select: { id: true } });
  const ids = labs.map((l) => l.id);
  await prisma.submission.deleteMany({ where: { labId: { in: ids } } });
  await prisma.examViolation.deleteMany({ where: { labId: { in: ids } } });
  await prisma.executionRecord.deleteMany({ where: { workspace: { labId: { in: ids } } } });
  await prisma.labWorkspace.deleteMany({ where: { labId: { in: ids } } });
  await prisma.answerSheetSection.deleteMany({ where: { labId: { in: ids } } });
  await prisma.examAdminAction.deleteMany({ where: { labId: { in: ids } } });
  await prisma.lab.deleteMany({ where: { id: { in: ids } } });
  await prisma.studentProfile.deleteMany({ where: { userId: fx.student.id } });
  await prisma.user.delete({ where: { id: fx.student.id } });
  await prisma.$disconnect();
});

const create = (name, { start, end = null, duration = null }) =>
  api('/api/lecturer/labs', {
    token: fx.lect, method: 'POST',
    body: { title: `${tag} ${name}`, description: 'd', problemStatement: 'Print hello', year: fx.subject.year, branchId: fx.subject.branchId, subjectId: fx.subject.id,
      allowedLanguages: ['python'], examModeEnabled: true, isPublished: true, examDate: iso(start), startTime: iso(start), endTime: end ? iso(end) : null, durationMinutes: duration },
  });

// Status as each dashboard shows it, read from its own API.
async function statuses(labId) {
  const lect = (await api(`/api/lecturer/labs?subjectId=${fx.subject.id}`, { token: fx.lect })).json.labs.find((l) => l.id === labId);
  const stuJson = (await api('/api/student/labs', { token: fx.stu })).json;
  let stu = null;
  JSON.stringify(stuJson, (k, v) => (v && v.id === labId && v.status ? ((stu = v.status), v) : v));
  return { lecturer: lect?.status, student: stu, scheduleProblem: lect?.scheduleProblem ?? null };
}
const act = (labId, body) => api('/api/student/workspace', { token: fx.stu, method: 'POST', headers: ua, body: { labId, ...body } });

test('saving a schedule whose end is not after its start is refused (the original bug)', async () => {
  const start = Date.now() + 60_000;
  const a = await create('A end==start', { start, end: start, duration: 5 });
  assert.equal(a.status, 400, JSON.stringify(a.json));
  assert.match(a.json.error, /after the start time/);
  const b = await create('B am-pm slip', { start, end: start - 12 * 3600_000, duration: 180 });
  assert.equal(b.status, 400);
  const short = await create('window shorter than duration', { start, end: start + 30 * 60_000, duration: 60 });
  assert.equal(short.status, 400);
  assert.match(short.json.error, /shorter than the duration/);
});

test('UPCOMING before start, then RUNNING with full access for the whole window; refresh keeps the clock', async () => {
  const start = Date.now() + 4000;
  const c = await create('active window', { start, duration: 5 }); // no end time: window = start + 5 min
  assert.equal(c.status, 200, JSON.stringify(c.json));
  const labId = c.json.lab.id;
  await api(`/api/student/workspace?labId=${labId}`, { token: fx.stu, headers: ua }); // opens the workspace (no clock)

  assert.deepEqual(await statuses(labId), { lecturer: 'UPCOMING', student: 'UPCOMING', scheduleProblem: null });
  const early = await act(labId, { action: 'start_exam', sessionId: 's1' });
  assert.equal(early.status, 403, 'cannot enter before the start');
  assert.match(early.json.error, /UPCOMING/);

  await sleep(start - Date.now() + 1200);
  assert.deepEqual(await statuses(labId), { lecturer: 'RUNNING', student: 'RUNNING', scheduleProblem: null }, 'did not complete at start');
  const started = await act(labId, { action: 'start_exam', sessionId: 's1' });
  assert.equal(started.status, 200, JSON.stringify(started.json));
  const deadline = new Date(started.json.effectiveDeadline).getTime();
  assert.ok(deadline - Date.now() > 4 * 60_000, `deadline only ${Math.round((deadline - Date.now()) / 1000)} s away`);

  // Refresh / session recovery: same attempt, same deadline.
  const reload = await api(`/api/student/workspace?labId=${labId}`, { token: fx.stu, headers: ua });
  assert.equal(reload.json.effectiveDeadline, started.json.effectiveDeadline);
  assert.equal(reload.json.workspace.startedAt, started.json.workspace.startedAt);

  // Work: save, run code with stdin, submit with a receipt.
  const fileId = reload.json.workspace.files[0].id;
  assert.equal((await act(labId, { action: 'save_file', fileId, content: 'n=int(input())\nprint(n*2)' })).status, 200);
  const run = await runOnEngine({ token: fx.stu, labId, filename: reload.json.workspace.files[0].filename, code: 'n=int(input())\nprint("double", n*2)', inputs: ['21\r'] });
  assert.equal(run.exitCode, 0, run.output);
  assert.match(run.programOutput, /double 42/);
  // Fill the answer sheet the lecturer configured (manual submit enforces required sections).
  for (const section of reload.json.answerSheetSections.filter((s) => s.enabled !== false && s.kind !== 'CODE' && s.key !== 'CODE')) {
    const saved = await act(labId, { action: 'save_section', sectionId: section.id, content: `${section.label} written by the student.` });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
  }
  const sub = await act(labId, { action: 'submit_lab' });
  assert.equal(sub.status, 200, JSON.stringify(sub.json));
  assert.equal(sub.json.receipt.onTime, true);
});

test('a 180-minute exam is RUNNING after its start, with a deadline 180 minutes out', async () => {
  const start = Date.now() - 60_000; // started a minute ago
  const c = await create('180 minutes', { start, duration: 180 });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  const labId = c.json.lab.id;
  assert.deepEqual(await statuses(labId), { lecturer: 'RUNNING', student: 'RUNNING', scheduleProblem: null });
  await api(`/api/student/workspace?labId=${labId}`, { token: fx.stu, headers: ua });
  const started = await act(labId, { action: 'start_exam', sessionId: 's2' });
  assert.equal(started.status, 200, JSON.stringify(started.json));
  const minutesLeft = (new Date(started.json.effectiveDeadline).getTime() - Date.now()) / 60_000;
  assert.ok(minutesLeft > 178 && minutesLeft <= 180, `minutes left ${minutesLeft}`);
});

test('at the end of the window: COMPLETED on both dashboards; work, runs and entry refused', async () => {
  const start = Date.now() - 60_000;
  const end = Date.now() + 5000;
  const c = await create('expiring', { start, end, duration: 1 });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  const labId = c.json.lab.id;
  await api(`/api/student/workspace?labId=${labId}`, { token: fx.stu, headers: ua });
  const started = await act(labId, { action: 'start_exam', sessionId: 's3' });
  assert.equal(started.status, 200);
  const fileId = started.json.workspace.files[0].id;
  await sleep(end - Date.now() + 1200);
  assert.deepEqual(await statuses(labId), { lecturer: 'COMPLETED', student: 'COMPLETED', scheduleProblem: null });
  assert.equal((await act(labId, { action: 'save_file', fileId, content: 'late' })).status, 403);
  const run = await runOnEngine({ token: fx.stu, labId, filename: 'main.py', code: 'print("late")' });
  assert.ok(run.errors.some((e) => /TIME_EXPIRED|EXAM_NOT_ACTIVE|ALREADY_SUBMITTED/.test(e.code)), JSON.stringify(run.errors));
  assert.doesNotMatch(run.programOutput, /late/);
});

test('an already-stored broken schedule: repaired by its duration, flagged to the lecturer, still editable', async () => {
  const start = new Date(Date.now() - 60_000);
  // As the old code stored it: end 12 hours BEFORE the start (AM/PM slip), duration 180.
  const lab = await prisma.lab.create({ data: { title: `${tag} legacy broken`, description: 'd', problemStatement: 'p', year: fx.subject.year, branchId: fx.subject.branchId, subjectId: fx.subject.id, lecturerId: fx.subject.lecturerId, isPublished: true, allowedLanguages: 'python', startTime: start, endTime: new Date(start.getTime() - 12 * 3600_000), durationMinutes: 180 } });
  const s = await statuses(lab.id);
  assert.equal(s.lecturer, 'RUNNING');
  assert.equal(s.student, 'RUNNING');
  assert.match(s.scheduleProblem, /duration instead/);
  // Unrelated edits still work; saving the broken schedule again does not.
  assert.equal((await api('/api/lecturer/labs', { token: fx.lect, method: 'PUT', body: { id: lab.id, title: `${tag} legacy renamed` } })).status, 200);
  assert.equal((await api('/api/lecturer/labs', { token: fx.lect, method: 'PUT', body: { id: lab.id, endTime: iso(start.getTime() - 3600_000) } })).status, 400);
  assert.equal((await api('/api/lecturer/labs', { token: fx.lect, method: 'PUT', body: { id: lab.id, endTime: iso(start.getTime() + 180 * 60_000) } })).status, 200);
  assert.equal((await statuses(lab.id)).scheduleProblem, null, 'fixed schedule no longer flagged');
});
