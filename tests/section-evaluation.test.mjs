// Section-wise evaluation (iteration 7): weighted sections are marked individually and roll
// up into Submission.marks; unweighted exams keep the flat mark; marks are validated; students
// see the breakdown only once published.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, prisma, tokenFor } from './helpers.mjs';
import { evaluateSectionMarks, gradableSections, validateFlatMarks } from '../src/lib/answerSheet.ts';

const tag = `secteval_${Date.now()}`;
const fx = {};

async function makeExam(title, sections) {
  return prisma.lab.create({
    data: {
      title: `${tag} ${title}`, description: 'fixture', problemStatement: 'p', year: 2, lecturerId: fx.owner.id, isPublished: true,
      answerSheetSections: { create: sections },
    },
    include: { answerSheetSections: true },
  });
}
async function makeSubmission(lab, who) {
  const ws = await prisma.labWorkspace.create({ data: { labId: lab.id, studentId: who.id, isSubmitted: true, startedAt: new Date() } });
  return prisma.submission.create({ data: { labId: lab.id, studentId: who.id, workspaceId: ws.id } });
}
const evaluate = (token, body) => api('/api/lecturer/evaluate', { token, method: 'POST', body });
const sec = (lab, key) => lab.answerSheetSections.find((s) => s.key === key);

before(async () => {
  [fx.owner, fx.otherLecturer] = await prisma.user.findMany({ where: { role: 'LECTURER' }, take: 2 });
  fx.ownerToken = tokenFor(fx.owner);
  const roll = `5555${String(Date.now()).slice(-8)}`;
  fx.student = await prisma.user.create({
    data: { name: `${tag} student`, role: 'STUDENT', rollNumber: roll, password: 'x', studentProfile: { create: { rollNumber: roll, year: 2 } } },
  });
  fx.studentToken = tokenFor(fx.student);
  // Weighted: Algorithm 10, Code 30, Output 10 (=50). Aim unweighted, Conclusion weighted but disabled.
  fx.weighted = await makeExam('weighted', [
    { key: 'AIM', label: 'Aim', order: 1 },
    { key: 'ALGORITHM', label: 'Algorithm', order: 2, maxMarks: 10 },
    { key: 'CODE', label: 'Code', order: 3, maxMarks: 30, contentSource: 'CODE_FILES' },
    { key: 'OUTPUT', label: 'Output', order: 4, maxMarks: 10, contentSource: 'EXECUTION_IO' },
    { key: 'CONCLUSION', label: 'Conclusion', order: 5, maxMarks: 5, enabled: false },
  ]);
  fx.flat = await makeExam('flat', [{ key: 'AIM', label: 'Aim', order: 1 }]);
  fx.foreign = await makeExam('foreign', [{ key: 'CODE', label: 'Code', order: 1, maxMarks: 20, contentSource: 'CODE_FILES' }]);
  fx.wSub = await makeSubmission(fx.weighted, fx.student);
  fx.fSub = await makeSubmission(fx.flat, fx.student);
});

after(async () => {
  const labs = [fx.weighted, fx.flat, fx.foreign].filter(Boolean).map((l) => l.id);
  await prisma.submission.deleteMany({ where: { labId: { in: labs } } });
  await prisma.labWorkspace.deleteMany({ where: { labId: { in: labs } } });
  await prisma.lab.deleteMany({ where: { id: { in: labs } } });
  await prisma.studentProfile.deleteMany({ where: { userId: fx.student.id } });
  await prisma.user.delete({ where: { id: fx.student.id } });
  await prisma.$disconnect();
});

// ── Pure rules ──────────────────────────────────────────────────────────────────────────
test('gradableSections: enabled sections with a positive weighting only', () => {
  const g = gradableSections(fx.weighted.answerSheetSections).map((s) => s.key).sort();
  assert.deepEqual(g, ['ALGORITHM', 'CODE', 'OUTPUT']);
});

test('evaluateSectionMarks: totals only when complete; validates range, type, duplicates, foreign ids', () => {
  const S = fx.weighted.answerSheetSections;
  const id = (k) => sec(fx.weighted, k).id;
  const full = evaluateSectionMarks(S, [{ sectionId: id('ALGORITHM'), marks: 8.5 }, { sectionId: id('CODE'), marks: '25' }, { sectionId: id('OUTPUT'), marks: 10 }]);
  assert.deepEqual([full.errors, full.total, full.maxTotal, full.complete], [[], 43.5, 50, true]);
  const partial = evaluateSectionMarks(S, [{ sectionId: id('CODE'), marks: 20 }]);
  assert.deepEqual([partial.total, partial.complete], [null, false]);
  for (const bad of [-1, 31, 'abc', NaN, Infinity]) {
    assert.equal(evaluateSectionMarks(S, [{ sectionId: id('CODE'), marks: bad }]).errors.length, 1, `marks ${bad}`);
  }
  assert.equal(evaluateSectionMarks(S, [{ sectionId: id('AIM'), marks: 1 }]).errors.length, 1, 'unweighted section');
  assert.equal(evaluateSectionMarks(S, [{ sectionId: id('CONCLUSION'), marks: 1 }]).errors.length, 1, 'disabled section');
  assert.equal(evaluateSectionMarks(S, [{ sectionId: id('CODE'), marks: 1 }, { sectionId: id('CODE'), marks: 2 }]).errors.length, 1, 'duplicate');
  assert.equal(evaluateSectionMarks(S, [{ sectionId: 'x', marks: 1 }]).errors.length, 1, 'unknown id');
});

test('validateFlatMarks: 0..max, numbers only, blank allowed', () => {
  assert.deepEqual(validateFlatMarks('72.5', 100), { marks: 72.5, error: null });
  assert.deepEqual(validateFlatMarks('', 100), { marks: null, error: null });
  for (const bad of [-5, 101, 'ten']) assert.ok(validateFlatMarks(bad, 100).error, String(bad));
});

// ── API: section-wise ───────────────────────────────────────────────────────────────────
test('partial section marks save unpublished, total stays empty', async () => {
  const r = await evaluate(fx.ownerToken, {
    submissionId: fx.wSub.id, status: 'PENDING', isPublished: false,
    sectionMarks: [{ sectionId: sec(fx.weighted, 'CODE').id, marks: 24, remarks: 'Good structure' }],
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const sub = await prisma.submission.findUnique({ where: { id: fx.wSub.id }, include: { sectionEvaluations: true } });
  assert.equal(sub.marks, null);
  assert.equal(sub.maxMarks, 50);
  assert.equal(sub.sectionEvaluations.length, 1);
  assert.equal(sub.sectionEvaluations[0].remarks, 'Good structure');
});

test('publishing with a weighted section unmarked is refused', async () => {
  const r = await evaluate(fx.ownerToken, {
    submissionId: fx.wSub.id, status: 'APPROVED', isPublished: true,
    sectionMarks: [{ sectionId: sec(fx.weighted, 'ALGORITHM').id, marks: 7 }],
  });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /Every marked section needs a mark/);
  const sub = await prisma.submission.findUnique({ where: { id: fx.wSub.id }, include: { sectionEvaluations: true } });
  assert.equal(sub.isPublished, false, 'nothing published');
  assert.equal(sub.sectionEvaluations.length, 1, 'refused request wrote nothing');
});

test('completing the remaining sections rolls up the total and publishes; earlier marks are kept', async () => {
  const r = await evaluate(fx.ownerToken, {
    submissionId: fx.wSub.id, status: 'APPROVED', isPublished: true, remarks: 'Well done',
    marks: 99, // must be ignored in section mode
    sectionMarks: [
      { sectionId: sec(fx.weighted, 'ALGORITHM').id, marks: 8 },
      { sectionId: sec(fx.weighted, 'OUTPUT').id, marks: '9.5' },
    ],
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const sub = await prisma.submission.findUnique({ where: { id: fx.wSub.id }, include: { sectionEvaluations: true } });
  assert.equal(sub.marks, 41.5, '24 (kept) + 8 + 9.5');
  assert.equal(sub.maxMarks, 50);
  assert.equal(sub.isPublished, true);
  assert.equal(sub.sectionEvaluations.length, 3);
});

test('re-grading a section updates it in place (no duplicate rows) and re-totals', async () => {
  const r = await evaluate(fx.ownerToken, {
    submissionId: fx.wSub.id, status: 'APPROVED', isPublished: true,
    sectionMarks: [{ sectionId: sec(fx.weighted, 'CODE').id, marks: 30 }],
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const sub = await prisma.submission.findUnique({ where: { id: fx.wSub.id }, include: { sectionEvaluations: true } });
  assert.equal(sub.marks, 47.5);
  assert.equal(sub.sectionEvaluations.length, 3);
});

test('invalid section marks are rejected and nothing changes', async () => {
  const cases = [
    [{ sectionId: sec(fx.weighted, 'CODE').id, marks: 31 }],
    [{ sectionId: sec(fx.weighted, 'CODE').id, marks: -1 }],
    [{ sectionId: sec(fx.weighted, 'CODE').id, marks: 'lots' }],
    [{ sectionId: sec(fx.weighted, 'AIM').id, marks: 1 }],
    [{ sectionId: sec(fx.foreign, 'CODE').id, marks: 1 }],
  ];
  for (const sectionMarks of cases) {
    const r = await evaluate(fx.ownerToken, { submissionId: fx.wSub.id, status: 'APPROVED', sectionMarks });
    assert.equal(r.status, 400, JSON.stringify(sectionMarks));
  }
  assert.equal((await evaluate(fx.ownerToken, { submissionId: fx.wSub.id, status: 'APPROVED', sectionMarks: 'x' })).status, 400);
  assert.equal((await prisma.submission.findUnique({ where: { id: fx.wSub.id } })).marks, 47.5);
});

test('section marks on an exam with no weighted sections are refused', async () => {
  const r = await evaluate(fx.ownerToken, { submissionId: fx.fSub.id, status: 'APPROVED', sectionMarks: [] });
  assert.equal(r.status, 400);
});

// ── API: flat path (backward compatibility) ─────────────────────────────────────────────
test('flat mark path unchanged for unweighted exams, now range-checked', async () => {
  assert.equal((await evaluate(fx.ownerToken, { submissionId: fx.fSub.id, status: 'APPROVED', marks: 101 })).status, 400);
  assert.equal((await evaluate(fx.ownerToken, { submissionId: fx.fSub.id, status: 'APPROVED', marks: -3 })).status, 400);
  assert.equal((await evaluate(fx.ownerToken, { submissionId: fx.fSub.id, status: 'APPROVED', marks: 'abc' })).status, 400);
  const ok = await evaluate(fx.ownerToken, { submissionId: fx.fSub.id, status: 'APPROVED', marks: 88, remarks: 'Fine', isPublished: false });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const sub = await prisma.submission.findUnique({ where: { id: fx.fSub.id } });
  assert.deepEqual([sub.marks, sub.maxMarks, sub.isPublished], [88, 100, false]);
});

// ── Access ──────────────────────────────────────────────────────────────────────────────
test('only the owning lecturer (or admin) can evaluate; students cannot', async () => {
  const body = { submissionId: fx.wSub.id, status: 'REJECTED', sectionMarks: [{ sectionId: sec(fx.weighted, 'CODE').id, marks: 0 }] };
  assert.equal((await evaluate(tokenFor(fx.otherLecturer), body)).status, 403);
  assert.equal((await evaluate(fx.studentToken, body)).status, 403);
  assert.equal((await prisma.submission.findUnique({ where: { id: fx.wSub.id } })).status, 'APPROVED');
});

// ── Read paths ──────────────────────────────────────────────────────────────────────────
test('faculty submissions payload carries saved section evaluations for prefill', async () => {
  const r = await api(`/api/lecturer/submissions?labId=${fx.weighted.id}`, { token: fx.ownerToken });
  assert.equal(r.status, 200);
  const s = r.json.submissions.find((x) => x.id === fx.wSub.id);
  const code = s.answerSheet.find((x) => x.key === 'CODE');
  assert.deepEqual(code.evaluation, { marks: 30, remarks: null });
  assert.equal(s.answerSheet.find((x) => x.key === 'AIM').evaluation, null);
});

test('student sees the section breakdown for published results only', async () => {
  let r = await api('/api/student/grades', { token: fx.studentToken });
  assert.equal(r.status, 200);
  const g = r.json.grades.find((x) => x.id === fx.wSub.id);
  assert.equal(g.marks, 47.5);
  assert.equal(g.maxMarks, 50);
  assert.deepEqual(g.sections.map((s) => [s.label, s.marks, s.maxMarks]), [['Algorithm', 8, 10], ['Code', 30, 30], ['Output', 9.5, 10]]);
  assert.ok(!r.json.grades.some((x) => x.id === fx.fSub.id), 'unpublished flat result hidden');
  // Unpublish → disappears entirely.
  await evaluate(fx.ownerToken, { submissionId: fx.wSub.id, status: 'APPROVED', isPublished: false });
  r = await api('/api/student/grades', { token: fx.studentToken });
  assert.ok(!r.json.grades.some((x) => x.id === fx.wSub.id));
});
