// Tamper-evident audit log (iteration 13).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { api, prisma, tokenFor, BASE_URL } from './helpers.mjs';
import { verifyAuditRows, redact } from '../src/lib/audit.ts';

const tag = `audit_${Date.now()}`;
const PASSWORD = 'Audit-Secret-Pass-91';
const fx = {};
const ip = () => ({ 'x-forwarded-for': `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
const eventsFor = (where) => prisma.auditEvent.findMany({ where, orderBy: { seq: 'asc' } });
// Audit writes are awaited by the routes before they respond, so no polling is needed.

before(async () => {
  fx.admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  fx.lecturer = await prisma.user.create({ data: { name: `${tag} lect`, email: `${tag}@example.test`, role: 'LECTURER', password: await bcrypt.hash(PASSWORD, 10) } });
});
after(async () => {
  await prisma.submission.deleteMany({ where: { lab: { title: { startsWith: tag } } } });
  await prisma.labWorkspace.deleteMany({ where: { lab: { title: { startsWith: tag } } } });
  await prisma.lab.deleteMany({ where: { title: { startsWith: tag } } });
  const users = await prisma.user.findMany({ where: { name: { startsWith: tag } }, select: { id: true } });
  await prisma.studentProfile.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await prisma.user.deleteMany({ where: { name: { startsWith: tag } } });
  // Audit rows are deliberately NOT deleted: the log is append-only, and deleting rows would
  // break the chain this suite verifies.
  await prisma.$disconnect();
});

test('failed and successful logins are recorded; the password never is', async () => {
  await api('/api/auth/login', { method: 'POST', body: { identifier: fx.lecturer.email, password: 'wrong-' + PASSWORD, role: 'FACULTY' }, headers: ip() });
  const ok = await api('/api/auth/login', { method: 'POST', body: { identifier: fx.lecturer.email, password: PASSWORD, role: 'FACULTY' }, headers: ip() });
  assert.equal(ok.status, 200);
  const evs = await eventsFor({ OR: [{ targetId: fx.lecturer.id }, { metadata: { path: ['identifier'], equals: fx.lecturer.email } }] });
  const actions = evs.map((e) => e.action);
  assert.ok(actions.includes('AUTH_LOGIN_FAILED') && actions.includes('AUTH_LOGIN_SUCCESS'), actions.join(','));
  const all = JSON.stringify(evs);
  assert.ok(!all.includes(PASSWORD), 'password value must not appear in the audit log');
  assert.ok(!all.includes(ok.json.token), 'token must not appear in the audit log');
});

test('exam creation, publishing, grading and result publication are recorded with before/after', async () => {
  const subject = await prisma.subject.findFirst({ where: { lecturerId: { not: null } }, include: { lecturer: true } });
  const lectToken = tokenFor(subject.lecturer);
  const day = new Date(Date.now() + 3 * 86_400_000);
  const at = (h) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h).toISOString();
  const created = await api('/api/lecturer/labs', { token: lectToken, method: 'POST', body: { title: `${tag} exam`, description: 'd', problemStatement: 'p', year: subject.year, branchId: subject.branchId, subjectId: subject.id, allowedLanguages: ['python'], examDate: at(0), startTime: at(10), endTime: at(12), durationMinutes: 60, isPublished: false } });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  const labId = created.json.lab.id;
  await api('/api/lecturer/labs', { token: lectToken, method: 'PUT', body: { id: labId, isPublished: true } });
  const examEvents = (await eventsFor({ targetId: labId })).map((e) => e.action);
  assert.deepEqual(examEvents, ['EXAM_CREATED', 'EXAM_UPDATED', 'EXAM_PUBLISHED']);
  const update = (await eventsFor({ targetId: labId, action: 'EXAM_UPDATED' }))[0];
  assert.deepEqual(update.metadata.changes.isPublished, { before: false, after: true });

  // A submission to grade.
  const roll = `4040${String(Date.now()).slice(-8)}`;
  const st = await prisma.user.create({ data: { name: `${tag} st`, role: 'STUDENT', rollNumber: roll, password: 'x', studentProfile: { create: { rollNumber: roll, year: subject.year, branchId: subject.branchId } } } });
  const ws = await prisma.labWorkspace.create({ data: { labId, studentId: st.id, isSubmitted: true, startedAt: new Date() } });
  const sub = await prisma.submission.create({ data: { labId, studentId: st.id, workspaceId: ws.id } });
  const g = await api('/api/lecturer/evaluate', { token: lectToken, method: 'POST', body: { submissionId: sub.id, status: 'APPROVED', marks: 73, isPublished: true } });
  assert.equal(g.status, 200, JSON.stringify(g.json));
  const grading = await eventsFor({ targetId: sub.id });
  assert.deepEqual(grading.map((e) => e.action), ['GRADE_SAVED', 'RESULT_PUBLISHED']);
  assert.equal(grading[0].actorId, subject.lecturer.id);
  assert.deepEqual([grading[0].metadata.before.marks, grading[0].metadata.after.marks], [null, 73]);
});

test('a finalized submission is recorded with the snapshot hash', async () => {
  const now = Date.now();
  const roll = `4041${String(now).slice(-8)}`;
  const st = await prisma.user.create({ data: { name: `${tag} st2`, role: 'STUDENT', rollNumber: roll, password: 'x', studentProfile: { create: { rollNumber: roll, year: 2 } } } });
  const lab = await prisma.lab.create({ data: { title: `${tag} sub`, description: 'd', problemStatement: 'p', year: 2, lecturerId: fx.lecturer.id, isPublished: true, allowedLanguages: 'python', durationMinutes: 60, examDate: new Date(now - 60000), startTime: new Date(now - 60000), endTime: new Date(now + 3600000) } });
  await prisma.labWorkspace.create({ data: { labId: lab.id, studentId: st.id, startedAt: new Date() } });
  const r = await api('/api/student/workspace', { token: tokenFor(st), method: 'POST', body: { labId: lab.id, action: 'submit_lab' }, headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
  assert.equal(r.status, 200);
  const snap = await prisma.submissionSnapshot.findFirst({ where: { submission: { labId: lab.id } } });
  const [ev] = await eventsFor({ action: 'SUBMISSION_FINALIZED', targetId: snap.submissionId });
  assert.equal(ev.metadata.contentHash, snap.contentHash);
  assert.equal(ev.actorId, st.id);
});

test('the chain verifies; an edited row is detected at exactly that row, and restoring it heals the chain', async () => {
  const adminToken = tokenFor(fx.admin);
  let v = await api('/api/admin/audit?verify=1', { token: adminToken });
  assert.equal(v.json.verification.ok, true, JSON.stringify(v.json));
  const victim = await prisma.auditEvent.findFirst({ where: { action: 'GRADE_SAVED' }, orderBy: { seq: 'desc' } });
  const original = victim.metadata;
  // A database owner can disable the append-only trigger; detection must not depend on it.
  await prisma.$executeRawUnsafe('ALTER TABLE "AuditEvent" DISABLE TRIGGER audit_event_append_only');
  try {
    await prisma.auditEvent.update({ where: { seq: victim.seq }, data: { metadata: { ...original, after: { ...original.after, marks: 100 } } } });
    v = await api('/api/admin/audit?verify=1', { token: adminToken });
    assert.equal(v.json.verification.ok, false);
    assert.equal(v.json.verification.brokenAtSeq, victim.seq);
  } finally {
    await prisma.auditEvent.update({ where: { seq: victim.seq }, data: { metadata: original } });
    await prisma.$executeRawUnsafe('ALTER TABLE "AuditEvent" ENABLE TRIGGER audit_event_append_only');
  }
  v = await api('/api/admin/audit?verify=1', { token: adminToken });
  assert.equal(v.json.verification.ok, true);
});

test('deleted and reordered rows are detected (on an in-memory copy)', async () => {
  const rows = await prisma.auditEvent.findMany({ orderBy: { seq: 'asc' } });
  assert.ok(rows.length >= 4);
  assert.equal(verifyAuditRows(rows).ok, true);
  const deleted = rows.filter((_, i) => i !== 2);
  assert.equal(verifyAuditRows(deleted).brokenAtSeq, rows[3].seq);
  const swapped = [...rows];
  [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
  assert.equal(verifyAuditRows(swapped).ok, false);
});

test('concurrent events never fork the chain', async () => {
  await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      api('/api/auth/login', { method: 'POST', body: { identifier: `${tag}-nobody-${i}@example.test`, password: 'x'.repeat(10), role: 'FACULTY' }, headers: ip() })
    )
  );
  const v = await api('/api/admin/audit?verify=1', { token: tokenFor(fx.admin) });
  assert.equal(v.json.verification.ok, true, JSON.stringify(v.json));
  const seqs = (await prisma.auditEvent.findMany({ select: { seq: true }, orderBy: { seq: 'asc' } })).map((r) => r.seq);
  assert.deepEqual(seqs, Array.from({ length: seqs.length }, (_, i) => seqs[0] + i), 'sequence has no gaps');
});

test('only admins can read or export the log; exports are themselves audited', async () => {
  assert.equal((await api('/api/admin/audit', { token: tokenFor(fx.lecturer) })).status, 403);
  assert.equal((await api('/api/admin/audit')).status, 401);
  const list = await api('/api/admin/audit?category=GRADING&limit=5', { token: tokenFor(fx.admin) });
  assert.equal(list.status, 200);
  assert.ok(list.json.events.every((e) => e.category === 'GRADING'));
  const res = await fetch(`${BASE_URL}/api/admin/audit?format=csv&limit=10`, { headers: { authorization: `Bearer ${tokenFor(fx.admin)}` } });
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match((await res.text()).split('\n')[0], /^seq,at,action/);
  const [exp] = await prisma.auditEvent.findMany({ where: { action: 'AUDIT_EXPORTED' }, orderBy: { seq: 'desc' }, take: 1 });
  assert.equal(exp.actorId, fx.admin.id);
});

test('redaction removes secret-looking keys at any depth', () => {
  assert.deepEqual(redact({ a: 1, password: 'p', nested: { apiToken: 't', ok: [{ secretKey: 's', x: 2 }] }, gone: undefined }), {
    a: 1, password: '[REDACTED]', nested: { apiToken: '[REDACTED]', ok: [{ secretKey: '[REDACTED]', x: 2 }] },
  });
});
