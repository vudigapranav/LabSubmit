// Admin deletions never destroy student work or detach exams (MVP_STABILIZATION_REPORT.md).
// Before: deleting a lecturer cascaded every exam they wrote (and all submissions/marks);
// deleting a branch cascaded its subjects and orphaned its exams and students; deleting a
// subject hid its exams from students; the lecturers endpoint deleted ANY user by id.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, prisma, tokenFor } from './helpers.mjs';

const tag = `admdel_${Date.now()}`;
const fx = {};

before(async () => {
  // A throwaway admin, never a real one: test 2 asks the server to delete this account, and a
  // build that still has the bug WILL delete it (that is how the missing role check was found).
  fx.admin = await prisma.user.create({ data: { name: `${tag} Admin`, email: `${tag}-admin@cbit.in`, role: 'ADMIN', password: 'x' } });
  fx.A = tokenFor(fx.admin);
  fx.branch = await prisma.branch.create({ data: { name: `${tag}-BR`, year: 4, isActive: true } });
  fx.lecturer = await prisma.user.create({ data: { name: `${tag} Lecturer`, email: `${tag}@cbit.in`, role: 'LECTURER', password: 'x' } });
  fx.subject = await prisma.subject.create({ data: { name: `${tag} Subject`, code: `${tag}`.slice(0, 12), semester: 7, year: 4, branchId: fx.branch.id, lecturerId: fx.lecturer.id } });
  fx.lab = await prisma.lab.create({ data: { title: `${tag} Exam`, description: 'd', problemStatement: 'p', year: 4, branchId: fx.branch.id, subjectId: fx.subject.id, lecturerId: fx.lecturer.id, isPublished: true, allowedLanguages: 'python' } });
  const roll = `7171${String(Date.now()).slice(-8)}`;
  fx.student = await prisma.user.create({ data: { name: `${tag} Student`, role: 'STUDENT', rollNumber: roll, password: 'x', studentProfile: { create: { rollNumber: roll, year: 4, branchId: fx.branch.id } } } });
  fx.ws = await prisma.labWorkspace.create({ data: { labId: fx.lab.id, studentId: fx.student.id, startedAt: new Date() } });
});

after(async () => {
  await prisma.labWorkspace.deleteMany({ where: { labId: fx.lab.id } });
  await prisma.lab.deleteMany({ where: { id: fx.lab.id } });
  await prisma.subject.deleteMany({ where: { id: fx.subject.id } });
  await prisma.studentProfile.deleteMany({ where: { userId: fx.student.id } });
  await prisma.user.deleteMany({ where: { id: { in: [fx.student.id, fx.lecturer.id, fx.admin.id] } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: tag } } });
  await prisma.$disconnect();
});

const del = (path, id) => api(`/api/admin/${path}?id=${id}`, { token: fx.A, method: 'DELETE' });

test('a lecturer who authored exams cannot be deleted (it would cascade every submission)', async () => {
  const r = await del('lecturers', fx.lecturer.id);
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.code, 'LECTURER_HAS_EXAMS');
  assert.equal(r.json.counts.exams, 1);
  assert.ok(await prisma.lab.findUnique({ where: { id: fx.lab.id } }), 'exam still exists');
});

test('the lecturers endpoint refuses to delete a non-lecturer (admin, student, self)', async () => {
  assert.equal((await del('lecturers', fx.admin.id)).status, 404);
  assert.equal((await del('lecturers', fx.student.id)).status, 404);
  assert.ok(await prisma.user.findUnique({ where: { id: fx.admin.id } }));
  assert.ok(await prisma.user.findUnique({ where: { id: fx.student.id } }));
});

test('a student who has sat an exam cannot be deleted', async () => {
  const r = await del('students', fx.student.id);
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.code, 'STUDENT_HAS_WORK');
  assert.ok(await prisma.labWorkspace.findUnique({ where: { id: fx.ws.id } }));
});

test('a subject with exams cannot be deleted (it would hide them from students)', async () => {
  const r = await del('subjects', fx.subject.id);
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.code, 'SUBJECT_IN_USE');
  assert.equal((await prisma.lab.findUnique({ where: { id: fx.lab.id } })).subjectId, fx.subject.id);
});

test('a branch in use cannot be deleted; it can be closed instead', async () => {
  const r = await del('branches', fx.branch.id);
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.code, 'BRANCH_IN_USE');
  assert.deepEqual(r.json.counts, { subjects: 1, exams: 1, students: 1 });
  const profile = await prisma.studentProfile.findUnique({ where: { userId: fx.student.id } });
  assert.equal(profile.branchId, fx.branch.id, 'student not detached');
  const closed = await api('/api/admin/branches', { token: fx.A, method: 'PUT', body: { id: fx.branch.id, isActive: false } });
  assert.equal(closed.status, 200, JSON.stringify(closed.json));
  assert.equal((await prisma.branch.findUnique({ where: { id: fx.branch.id } })).isActive, false);
});

test('records with nothing depending on them still delete, and the deletion is audited', async () => {
  const empty = await prisma.branch.create({ data: { name: `${tag}-EMPTY`, year: 4 } });
  const r = await del('branches', empty.id);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const audit = await prisma.auditEvent.findFirst({ where: { action: 'ADMIN_BRANCH_DELETED', targetId: empty.id } });
  assert.ok(audit, 'branch deletion audited');

  const lonelyStudentRoll = `7272${String(Date.now()).slice(-8)}`;
  const lonely = await prisma.user.create({ data: { name: `${tag} Unused`, role: 'STUDENT', rollNumber: lonelyStudentRoll, password: 'x', studentProfile: { create: { rollNumber: lonelyStudentRoll, year: 4, branchId: fx.branch.id } } } });
  assert.equal((await del('students', lonely.id)).status, 200, 'a student with no exam activity can be deleted');
});

test('a deleted account loses API access at once, not when its 7-day token expires', async () => {
  const roll = `7373${String(Date.now()).slice(-8)}`;
  const gone = await prisma.user.create({ data: { name: `${tag} Gone`, role: 'STUDENT', rollNumber: roll, password: 'x', studentProfile: { create: { rollNumber: roll, year: 4, branchId: fx.branch.id } } } });
  const token = tokenFor(gone);
  assert.equal((await api('/api/student/labs', { token })).status, 200, 'works while the account exists');
  assert.equal((await del('students', gone.id)).status, 200);
  const after = await api('/api/student/labs', { token });
  assert.equal(after.status, 401, JSON.stringify(after.json));
  assert.equal((await api('/api/auth/me', { token })).status === 200, false, 'the session endpoint no longer accepts it');
});

test('a token claiming a role the account does not have is refused', async () => {
  // Validly signed, but the account is a LECTURER (e.g. its role changed after the token was issued).
  const forged = tokenFor({ ...fx.lecturer, role: 'ADMIN' });
  const r = await api('/api/admin/stats', { token: forged });
  assert.equal(r.status, 401, JSON.stringify(r.json));
});
