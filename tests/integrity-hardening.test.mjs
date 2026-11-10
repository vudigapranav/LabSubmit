// Integrity against PRIVILEGED database modification (security blocker items 3 and 4).
// The attacker modelled here has database write access — including disabling triggers — but
// not the server environment (INTEGRITY_KEY). Every tamper is restored exactly afterwards.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, prisma, tokenFor } from './helpers.mjs';
import { computeAuditHash, verifyAuditRows } from '../src/lib/audit.ts';
import { snapshotHash } from '../src/lib/submissionSnapshot.ts';

const tag = `integ_${Date.now()}`;
const fx = {};
const headers = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
const disable = (t, trg) => prisma.$executeRawUnsafe(`ALTER TABLE "${t}" DISABLE TRIGGER ${trg}`);
const enable = (t, trg) => prisma.$executeRawUnsafe(`ALTER TABLE "${t}" ENABLE TRIGGER ${trg}`);

before(async () => {
  assert.ok((process.env.INTEGRITY_KEY || '').length >= 32, 'these tests need INTEGRITY_KEY in .env (and the server restarted with it)');
  fx.admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  fx.lecturer = await prisma.user.findFirst({ where: { role: 'LECTURER' } });
  // Produce a few signed audit rows to attack.
  for (let i = 0; i < 4; i++) {
    await api('/api/auth/login', { method: 'POST', body: { identifier: `${tag}-${i}@example.test`, password: 'x'.repeat(10), role: 'FACULTY' }, headers: { 'x-forwarded-for': `10.88.0.${i + 1}` } });
  }
});
after(async () => {
  const labs = await prisma.lab.findMany({ where: { title: { startsWith: tag } }, select: { id: true } });
  await prisma.submission.deleteMany({ where: { labId: { in: labs.map((l) => l.id) } } });
  await prisma.labWorkspace.deleteMany({ where: { labId: { in: labs.map((l) => l.id) } } });
  await prisma.lab.deleteMany({ where: { id: { in: labs.map((l) => l.id) } } });
  const users = await prisma.user.findMany({ where: { name: { startsWith: tag } }, select: { id: true } });
  await prisma.studentProfile.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await prisma.user.deleteMany({ where: { name: { startsWith: tag } } });
  await prisma.$disconnect();
});

const verify = async () => (await api('/api/admin/audit?verify=1', { token: tokenFor(fx.admin) })).json.verification;

test('new audit rows are signed, and the chain verifies', async () => {
  const last = await prisma.auditEvent.findFirst({ orderBy: { seq: 'desc' } });
  assert.match(last.signature || '', /^[0-9a-f]{64}$/);
  const v = await verify();
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.ok(v.signed >= 4);
});

test('the database refuses UPDATE and DELETE on audit rows', async () => {
  const row = await prisma.auditEvent.findFirst({ orderBy: { seq: 'desc' } });
  await assert.rejects(prisma.auditEvent.update({ where: { seq: row.seq }, data: { action: 'X' } }), /append-only/);
  await assert.rejects(prisma.auditEvent.delete({ where: { seq: row.seq } }), /append-only/);
});

test('rewriting the chain from a row onward (recomputed hashes, no key) is detected by signatures', async () => {
  const tail = await prisma.auditEvent.findMany({ orderBy: { seq: 'desc' }, take: 3 });
  tail.reverse();
  const before = await prisma.auditEvent.findFirst({ where: { seq: { lt: tail[0].seq } }, orderBy: { seq: 'desc' } });
  await disable('AuditEvent', 'audit_event_append_only');
  try {
    // A thorough attacker: edit the first row, then recompute every hash and link after it.
    let prev = before.hash;
    for (const [i, row] of tail.entries()) {
      const forged = { ...row, ...(i === 0 ? { metadata: { ...row.metadata, identifier: 'someone-else' } } : {}) };
      const hash = computeAuditHash(prev, forged);
      await prisma.auditEvent.update({ where: { seq: row.seq }, data: { metadata: forged.metadata, prevHash: prev, hash } });
      prev = hash;
    }
    let v = await verify();
    assert.equal(v.ok, false, 'a recomputed chain must not verify');
    assert.equal(v.brokenAtSeq, tail[0].seq);
    assert.match(v.reason, /signature/);

    // ...and stripping the signatures of the rewritten rows is detected too (downgrade).
    for (const row of tail) await prisma.auditEvent.update({ where: { seq: row.seq }, data: { signature: null } });
    v = await verify();
    assert.equal(v.ok, false);
    assert.match(v.reason, /unsigned row after signing began|newest row/);
  } finally {
    // Restore exactly, newest first so the unique hash constraint never collides.
    for (const row of [...tail].reverse()) {
      await prisma.auditEvent.update({ where: { seq: row.seq }, data: { metadata: row.metadata, prevHash: row.prevHash, hash: row.hash, signature: row.signature } });
    }
    await enable('AuditEvent', 'audit_event_append_only');
  }
  assert.equal((await verify()).ok, true, 'restored chain verifies again');
});

test('stripping every signature in the log is detected (newest row must be signed)', () => {
  // In-memory: no need to touch the real table for this one.
  return prisma.auditEvent.findMany({ orderBy: { seq: 'asc' } }).then((rows) => {
    const stripped = rows.map((r) => ({ ...r, signature: null }));
    const v = verifyAuditRows(stripped);
    assert.equal(v.ok, false);
    assert.match(v.reason, /newest row/);
  });
});

async function submittedSnapshot() {
  const now = Date.now();
  const roll = `8181${String(now).slice(-8)}`;
  const st = await prisma.user.create({ data: { name: `${tag} st ${now}`, role: 'STUDENT', rollNumber: roll, password: 'x', studentProfile: { create: { rollNumber: roll, year: 2 } } } });
  const lab = await prisma.lab.create({ data: { title: `${tag} exam ${now}`, description: 'd', problemStatement: 'p', year: 2, lecturerId: fx.lecturer.id, isPublished: true, allowedLanguages: 'python', durationMinutes: 60, examDate: new Date(now - 60000), startTime: new Date(now - 60000), endTime: new Date(now + 3600000) } });
  await prisma.labWorkspace.create({ data: { labId: lab.id, studentId: st.id, startedAt: new Date(), files: { create: [{ filename: 'main.py', language: 'python', content: 'print("honest")' }] } } });
  const r = await api('/api/student/workspace', { token: tokenFor(st), method: 'POST', headers, body: { labId: lab.id, action: 'submit_lab' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const snap = await prisma.submissionSnapshot.findFirst({ where: { submission: { labId: lab.id } } });
  return { st, lab, snap };
}
const inspectorView = async (labId) => (await api(`/api/lecturer/submissions?labId=${labId}`, { token: tokenFor(fx.lecturer) })).json.submissions[0].snapshots[0];

test('the database refuses to UPDATE a hand-in snapshot', async () => {
  const { snap } = await submittedSnapshot();
  assert.match(snap.signature || '', /^[0-9a-f]{64}$/, 'new snapshots are signed');
  await assert.rejects(prisma.submissionSnapshot.update({ where: { id: snap.id }, data: { reason: 'X' } }), /append-only/);
});

test('a forged snapshot with a recomputed hash is detected; so is a stripped signature', async () => {
  const { st, lab, snap } = await submittedSnapshot();
  const forgedFiles = [{ filename: 'main.py', language: 'python', content: 'print("forged")' }];
  const forgedHash = snapshotHash({ submissionId: snap.submissionId, labId: lab.id, studentId: st.id, version: snap.version, submittedAt: snap.submittedAt }, forgedFiles, snap.answers);
  await disable('SubmissionSnapshot', 'submission_snapshot_immutable');
  try {
    await prisma.submissionSnapshot.update({ where: { id: snap.id }, data: { files: forgedFiles, contentHash: forgedHash } });
    let view = await inspectorView(lab.id);
    assert.deepEqual([view.hashValid, view.signature, view.verified], [true, 'invalid', false], JSON.stringify(view));
    await prisma.submissionSnapshot.update({ where: { id: snap.id }, data: { signature: null } });
    view = await inspectorView(lab.id);
    assert.deepEqual([view.signature, view.verified], ['unsigned', false], 'with a key configured, unsigned means stripped');
  } finally {
    await prisma.submissionSnapshot.update({ where: { id: snap.id }, data: { files: snap.files, contentHash: snap.contentHash, signature: snap.signature } });
    await enable('SubmissionSnapshot', 'submission_snapshot_immutable');
  }
  assert.equal((await inspectorView(lab.id)).verified, true, 'restored snapshot verifies');
});

test('nobody can permanently delete an exam that has hand-ins; it can be archived, and both are audited', async () => {
  const { lab } = await submittedSnapshot();
  const owner = await prisma.user.findUnique({ where: { id: lab.lecturerId } });
  // The exam-lifecycle rule (archive instead of delete) applies to every role.
  for (const who of [owner, fx.admin]) {
    const refused = await api(`/api/lecturer/labs?id=${lab.id}`, { token: tokenFor(who), method: 'DELETE' });
    assert.equal(refused.status, 409, `${who.role}: ${JSON.stringify(refused.json)}`);
    assert.equal(refused.json.canArchive, true);
  }
  assert.equal(await prisma.submissionSnapshot.count({ where: { submission: { labId: lab.id } } }), 1, 'hand-in kept');

  const archived = await api('/api/lecturer/labs', { token: tokenFor(owner), method: 'PATCH', body: { id: lab.id, archived: true } });
  assert.equal(archived.status, 200, JSON.stringify(archived.json));
  const [ev] = await prisma.auditEvent.findMany({ where: { action: 'EXAM_ARCHIVED', targetId: lab.id } });
  assert.ok(ev, 'archive recorded in the hash-chained audit log');
  assert.equal(await prisma.submissionSnapshot.count({ where: { submission: { labId: lab.id } } }), 1, 'archive preserves hand-ins');

  const empty = await prisma.lab.create({ data: { title: `${tag} empty`, description: 'd', problemStatement: 'p', year: 2, lecturerId: owner.id } });
  assert.equal((await api(`/api/lecturer/labs?id=${empty.id}`, { token: tokenFor(owner), method: 'DELETE' })).status, 200, 'an exam with no student activity can still be deleted');
  assert.equal((await prisma.auditEvent.findMany({ where: { action: 'EXAM_DELETED', targetId: empty.id } })).length, 1);
});
