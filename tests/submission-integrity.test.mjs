// Submission integrity (iteration 11): immutable versioned snapshots with server timestamps
// and hashes, idempotent finalization under concurrency, server-decided on-time status, and
// evaluators grading what was handed in rather than the live workspace.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, prisma, tokenFor } from './helpers.mjs';
import { verifySnapshot } from '../src/lib/submissionSnapshot.ts';

const tag = `subint_${Date.now()}`;
const desktop = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36' };
const fx = {};

async function student(suffix) {
  const roll = `1111${String(Date.now()).slice(-6)}${suffix}`;
  return prisma.user.create({ data: { name: `${tag} ${suffix}`, role: 'STUDENT', rollNumber: roll, password: 'x', studentProfile: { create: { rollNumber: roll, year: 2 } } } });
}
async function attempt(who, { startedMinutesAgo = 1, durationMinutes = 60 } = {}) {
  const now = Date.now();
  const lab = await prisma.lab.create({
    data: {
      title: `${tag} exam ${who.name}`, description: 'd', problemStatement: 'p', year: 2, lecturerId: fx.lecturer.id, isPublished: true,
      allowedLanguages: 'python', durationMinutes, examDate: new Date(now - 7_200_000), startTime: new Date(now - 7_200_000), endTime: new Date(now + 7_200_000),
      answerSheetSections: { create: [{ key: 'AIM', label: 'Aim', order: 1 }] },
    },
    include: { answerSheetSections: true },
  });
  const ws = await prisma.labWorkspace.create({
    data: {
      labId: lab.id, studentId: who.id, startedAt: new Date(now - startedMinutesAgo * 60_000),
      files: { create: [{ filename: 'main.py', language: 'python', content: 'print("version one")' }] },
      answerSheetResponses: { create: [{ sectionId: lab.answerSheetSections[0].id, content: 'Original aim' }] },
    },
    include: { files: true },
  });
  return { lab, ws, token: tokenFor(who) };
}
const act = (a, body) => api('/api/student/workspace', { token: a.token, method: 'POST', body: { labId: a.lab.id, ...body }, headers: desktop });
const snapshotsOf = (labId) => prisma.submissionSnapshot.findMany({ where: { submission: { labId } }, orderBy: { version: 'asc' } });

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

test('a manual submit stores a server-timestamped, hashed snapshot of files and answers', async () => {
  const a = await attempt(await student('01'));
  const before = Date.now();
  const r = await act(a, { action: 'submit_lab', submittedAt: '2000-01-01T00:00:00Z' /* must be ignored */ });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const [snap] = await snapshotsOf(a.lab.id);
  assert.equal(snap.version, 1);
  assert.deepEqual(snap.files, [{ filename: 'main.py', language: 'python', content: 'print("version one")' }]);
  assert.deepEqual(snap.answers, [{ sectionKey: 'AIM', label: 'Aim', content: 'Original aim' }]);
  assert.ok(Math.abs(snap.submittedAt.getTime() - before) < 10_000, 'server time, not the client-supplied 2000-01-01');
  assert.equal(snap.onTime, true);
  assert.equal(snap.auto, false);
  assert.match(snap.contentHash, /^[0-9a-f]{64}$/);
  assert.ok(verifySnapshot(snap, { labId: a.lab.id, studentId: a.ws.studentId }));
});

test('concurrent submits create exactly one submission and one snapshot', async () => {
  const a = await attempt(await student('02'));
  const results = await Promise.all(Array.from({ length: 8 }, () => act(a, { action: 'submit_lab' })));
  assert.ok(results.every((r) => r.status === 200 || r.status === 403), results.map((r) => r.status).join(','));
  assert.ok(results.some((r) => r.status === 200));
  assert.equal(await prisma.submission.count({ where: { labId: a.lab.id } }), 1);
  assert.equal((await snapshotsOf(a.lab.id)).length, 1);
});

test('resubmission after "needs correction" keeps the original hand-in intact as version 1', async () => {
  const who = await student('03');
  const a = await attempt(who);
  assert.equal((await act(a, { action: 'submit_lab' })).status, 200);
  const sub = await prisma.submission.findFirst({ where: { labId: a.lab.id } });
  const back = await api('/api/lecturer/evaluate', { token: tokenFor(fx.lecturer), method: 'POST', body: { submissionId: sub.id, status: 'NEEDS_CORRECTION', isPublished: false } });
  assert.equal(back.status, 200, JSON.stringify(back.json));
  // Student edits after the attempt is reopened, then resubmits.
  assert.equal((await act(a, { action: 'save_file', fileId: a.ws.files[0].id, content: 'print("version two")' })).status, 200);
  assert.equal((await act(a, { action: 'submit_lab' })).status, 200);

  const snaps = await snapshotsOf(a.lab.id);
  assert.deepEqual(snaps.map((s) => s.version), [1, 2]);
  assert.equal(snaps[0].files[0].content, 'print("version one")', 'original hand-in preserved');
  assert.equal(snaps[1].files[0].content, 'print("version two")');

  // The evaluator sees the latest hand-in and the verified history.
  const r = await api(`/api/lecturer/submissions?labId=${a.lab.id}`, { token: tokenFor(fx.lecturer) });
  const s = r.json.submissions.find((x) => x.id === sub.id);
  assert.equal(s.files[0].content, 'print("version two")');
  assert.deepEqual(s.snapshots.map((x) => [x.version, x.verified]), [[2, true], [1, true]]);
});

test('the evaluator grades the hand-in, not later edits to a reopened workspace', async () => {
  const a = await attempt(await student('04'));
  assert.equal((await act(a, { action: 'submit_lab' })).status, 200);
  const sub = await prisma.submission.findFirst({ where: { labId: a.lab.id } });
  await api('/api/lecturer/evaluate', { token: tokenFor(fx.lecturer), method: 'POST', body: { submissionId: sub.id, status: 'NEEDS_CORRECTION', isPublished: false } });
  await act(a, { action: 'save_file', fileId: a.ws.files[0].id, content: 'print("work in progress")' });
  const r = await api(`/api/lecturer/submissions?labId=${a.lab.id}`, { token: tokenFor(fx.lecturer) });
  const s = r.json.submissions.find((x) => x.id === sub.id);
  assert.equal(s.files[0].content, 'print("version one")', 'unsubmitted edits must not appear as the submission');
  assert.equal(s.answerSheet.find((x) => x.key === 'AIM').content, 'Original aim');
});

test('an edited snapshot no longer verifies', async () => {
  const a = await attempt(await student('05'));
  await act(a, { action: 'submit_lab' });
  const [snap] = await snapshotsOf(a.lab.id);
  await prisma.submissionSnapshot.update({ where: { id: snap.id }, data: { files: [{ filename: 'main.py', language: 'python', content: 'print("forged")' }] } });
  const r = await api(`/api/lecturer/submissions?labId=${a.lab.id}`, { token: tokenFor(fx.lecturer) });
  assert.equal(r.json.submissions[0].snapshots[0].verified, false);
});

test('the server decides on-time: deadline auto-submit is on time, a manual hand-in after the deadline is not', async () => {
  // Started 90 minutes ago with a 60-minute duration → personal deadline passed.
  const timeout = await attempt(await student('06'), { startedMinutesAgo: 90 });
  const saveAfter = await act(timeout, { action: 'save_file', fileId: timeout.ws.files[0].id, content: 'print("too late")' });
  assert.equal(saveAfter.status, 403, 'saves after the deadline are refused');
  const [tSnap] = await snapshotsOf(timeout.lab.id);
  assert.deepEqual([tSnap.auto, tSnap.reason, tSnap.onTime, tSnap.files[0].content], [true, 'TIMEOUT', true, 'print("version one")']);

  const late = await attempt(await student('07'), { startedMinutesAgo: 90 });
  assert.equal((await act(late, { action: 'submit_lab' })).status, 200);
  const [lSnap] = await snapshotsOf(late.lab.id);
  assert.deepEqual([lSnap.auto, lSnap.onTime], [false, false]);
});

test('submit returns a server-time receipt, identical on a repeated submit', async () => {
  const a = await attempt(await student('08'));
  const first = await act(a, { action: 'submit_lab' });
  assert.equal(first.status, 200);
  assert.match(first.json.receipt.reference, /^[0-9a-f]{12}$/);
  const snap = (await snapshotsOf(a.lab.id))[0];
  assert.equal(first.json.receipt.reference, snap.contentHash.slice(0, 12));
  assert.equal(first.json.receipt.version, 1);
  // Retry after a "lost" response: confirmed with the same receipt, nothing new stored.
  const again = await act(a, { action: 'submit_lab' });
  assert.equal(again.status, 200, JSON.stringify(again.json));
  assert.equal(again.json.alreadySubmitted, true);
  assert.deepEqual(again.json.receipt, first.json.receipt);
  assert.equal((await snapshotsOf(a.lab.id)).length, 1);
});
