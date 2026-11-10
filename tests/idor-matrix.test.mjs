// Cross-owner (IDOR) matrix — security blocker item 7. Lecturer B attacks every object
// endpoint on lecturer A's exam; student S2 attacks student S1. Each case checks the request
// is refused AND that nothing changed or leaked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, prisma, tokenFor } from './helpers.mjs';

const tag = `idor_${Date.now()}`;
const headers = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
const fx = {};
const refused = (r) => r.status === 403 || r.status === 404;

before(async () => {
  [fx.A, fx.B] = await prisma.user.findMany({ where: { role: 'LECTURER' }, take: 2, orderBy: { createdAt: 'asc' } });
  const now = Date.now();
  fx.lab = await prisma.lab.create({ data: { title: `${tag} A's exam`, description: 'd', problemStatement: `${tag} SECRET`, year: 2, lecturerId: fx.A.id, isPublished: true, allowedLanguages: 'python', durationMinutes: 60, examDate: new Date(now - 60000), startTime: new Date(now - 60000), endTime: new Date(now + 3600000) } });
  fx.set = await prisma.questionSet.create({ data: { labId: fx.lab.id, label: 'Set A', questions: { create: [{ order: 1, text: `${tag} SET QUESTION` }] } } });
  const mk = async (s) => {
    const roll = `6161${String(now).slice(-6)}${s}`;
    return prisma.user.create({ data: { name: `${tag} ${s}`, role: 'STUDENT', rollNumber: roll, password: 'x', studentProfile: { create: { rollNumber: roll, year: 2 } } } });
  };
  fx.S1 = await mk('11');
  fx.S2 = await mk('22');
  fx.ws1 = await prisma.labWorkspace.create({ data: { labId: fx.lab.id, studentId: fx.S1.id, startedAt: new Date(), questionSetId: fx.set.id, files: { create: [{ filename: 'main.py', language: 'python', content: 'S1 code' }] } }, include: { files: true } });
  await prisma.labWorkspace.create({ data: { labId: fx.lab.id, studentId: fx.S2.id, startedAt: new Date() } });
  fx.sub = await prisma.submission.create({ data: { labId: fx.lab.id, studentId: fx.S1.id, workspaceId: fx.ws1.id } });
  await prisma.examViolation.create({ data: { labId: fx.lab.id, studentId: fx.S1.id, type: 'TAB_HIDDEN', severity: 'LOW' } });
});
after(async () => {
  await prisma.examViolation.deleteMany({ where: { labId: fx.lab.id } });
  await prisma.submission.deleteMany({ where: { labId: fx.lab.id } });
  await prisma.labWorkspace.deleteMany({ where: { labId: fx.lab.id } });
  await prisma.questionSet.deleteMany({ where: { labId: fx.lab.id } });
  await prisma.lab.deleteMany({ where: { id: fx.lab.id } });
  await prisma.studentProfile.deleteMany({ where: { userId: { in: [fx.S1.id, fx.S2.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [fx.S1.id, fx.S2.id] } } });
  await prisma.$disconnect();
});

test('lecturer B cannot read or change lecturer A\'s question sets', async () => {
  const B = tokenFor(fx.B);
  const reads = [
    await api(`/api/lecturer/question-sets?labId=${fx.lab.id}`, { token: B }),
    await api(`/api/lecturer/assignments?labId=${fx.lab.id}`, { token: B }),
  ];
  for (const r of reads) {
    assert.ok(refused(r), `status ${r.status}`);
    assert.doesNotMatch(JSON.stringify(r.json), /SET QUESTION|Set A/);
  }
  const writes = [
    await api('/api/lecturer/question-sets', { token: B, method: 'POST', body: { labId: fx.lab.id, label: 'hijack', questions: [{ text: 'x' }] } }),
    await api('/api/lecturer/question-sets', { token: B, method: 'PUT', body: { id: fx.set.id, label: 'renamed by B', acknowledgeLiveEdit: true } }),
    await api(`/api/lecturer/question-sets?id=${fx.set.id}`, { token: B, method: 'DELETE' }),
    await api('/api/lecturer/assignments', { token: B, method: 'POST', body: { labId: fx.lab.id, action: 'generate' } }),
    await api('/api/lecturer/assignments', { token: B, method: 'POST', body: { labId: fx.lab.id, action: 'reassign', studentId: fx.S1.id, questionSetId: fx.set.id } }),
  ];
  for (const r of writes) assert.ok(refused(r), `status ${r.status} ${JSON.stringify(r.json)}`);
  assert.equal(await prisma.questionSet.count({ where: { labId: fx.lab.id } }), 1);
  assert.equal((await prisma.questionSet.findUnique({ where: { id: fx.set.id } })).label, 'Set A');
});

test('lecturer B cannot edit, delete, grade or inspect lecturer A\'s exam', async () => {
  const B = tokenFor(fx.B);
  assert.ok(refused(await api('/api/lecturer/labs', { token: B, method: 'PUT', body: { id: fx.lab.id, title: 'hijacked' } })));
  assert.ok(refused(await api(`/api/lecturer/labs?id=${fx.lab.id}`, { token: B, method: 'DELETE' })));
  assert.ok(refused(await api('/api/lecturer/evaluate', { token: B, method: 'POST', body: { submissionId: fx.sub.id, status: 'APPROVED', marks: 100, isPublished: true } })));
  assert.ok(refused(await api(`/api/lecturer/executions?submissionId=${fx.sub.id}`, { token: B })));
  const lab = await prisma.lab.findUnique({ where: { id: fx.lab.id } });
  const sub = await prisma.submission.findUnique({ where: { id: fx.sub.id } });
  assert.equal(lab.title, `${tag} A's exam`);
  assert.deepEqual([sub.marks, sub.isPublished], [null, false]);
});

test('lecturer B gets nothing of A\'s exam from list endpoints filtered by its id', async () => {
  const B = tokenFor(fx.B);
  const subs = await api(`/api/lecturer/submissions?labId=${fx.lab.id}`, { token: B });
  assert.equal(subs.status, 200);
  assert.equal(subs.json.submissions.length, 0);
  const viol = await api(`/api/lecturer/violations?labId=${fx.lab.id}`, { token: B });
  assert.doesNotMatch(JSON.stringify(viol.json), new RegExp(fx.S1.id));
  const labs = await api('/api/lecturer/labs', { token: B });
  assert.ok(!labs.json.labs.some((l) => l.id === fx.lab.id));
});

test('the owning lecturer still has full access (no false refusals)', async () => {
  const A = tokenFor(fx.A);
  assert.equal((await api(`/api/lecturer/question-sets?labId=${fx.lab.id}`, { token: A })).status, 200);
  assert.equal((await api(`/api/lecturer/submissions?labId=${fx.lab.id}`, { token: A })).json.submissions.length, 1);
  assert.equal((await api(`/api/lecturer/executions?submissionId=${fx.sub.id}`, { token: A })).status, 200);
});

test('student S2 cannot touch student S1\'s work, results or attempt', async () => {
  const S2 = tokenFor(fx.S2);
  const act = (body) => api('/api/student/workspace', { token: S2, method: 'POST', headers, body: { labId: fx.lab.id, ...body } });
  assert.ok(refused(await act({ action: 'save_file', fileId: fx.ws1.files[0].id, content: 'S2 was here' })));
  assert.ok(refused(await act({ action: 'rename_file', fileId: fx.ws1.files[0].id, newFilename: 'x.py' })));
  assert.ok(refused(await act({ action: 'delete_file', fileId: fx.ws1.files[0].id })));
  assert.equal((await prisma.labFile.findUnique({ where: { id: fx.ws1.files[0].id } })).content, 'S1 code');
  // S2's own workspace view never contains S1's code, set or submission.
  const own = await api(`/api/student/workspace?labId=${fx.lab.id}`, { token: S2, headers });
  assert.doesNotMatch(JSON.stringify(own.json), /S1 code|Set A/);
  const grades = await api('/api/student/grades', { token: S2 });
  assert.ok(!grades.json.grades.some((g) => g.id === fx.sub.id));
  // Faculty and admin endpoints refuse students outright.
  for (const p of [`/api/lecturer/submissions?labId=${fx.lab.id}`, `/api/lecturer/executions?submissionId=${fx.sub.id}`, '/api/admin/audit', '/api/admin/students']) {
    assert.equal((await api(p, { token: S2 })).status, 403, p);
  }
  assert.equal((await api('/api/lecturer/evaluate', { token: S2, method: 'POST', body: { submissionId: fx.sub.id, status: 'APPROVED', marks: 100 } })).status, 403);
});
