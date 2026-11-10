// Authorisation and token tests (SECURITY_AUDIT.md S5, S6, S12).
// Fixtures (a live exam, two students, their workspaces) are created directly in the
// database because the test is about what the API does with them; every action under test
// goes through the real HTTP API. Everything created is deleted in after().
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { api, prisma, tokenFor } from './helpers.mjs';

const tag = `acltest_${Date.now()}`;
const desktopUA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36' };
const fx = {};

before(async () => {
  const lecturer = await prisma.user.findFirst({ where: { role: 'LECTURER' } });
  const now = Date.now();
  fx.lecturer = lecturer;
  fx.lab = await prisma.lab.create({
    data: {
      title: `${tag} live exam`,
      description: 'access-control fixture',
      problemStatement: `${tag} SECRET PAPER TEXT`,
      year: 2,
      lecturerId: lecturer.id,
      isPublished: true,
      examDate: new Date(now - 60_000),
      startTime: new Date(now - 60_000),
      endTime: new Date(now + 60 * 60_000),
      durationMinutes: 60,
      allowedLanguages: 'c,python',
    },
  });
  // A draft that no student should ever be able to read.
  fx.draft = await prisma.lab.create({
    data: {
      title: `${tag} draft`,
      description: 'draft fixture',
      problemStatement: `${tag} DRAFT PAPER TEXT`,
      year: 2,
      lecturerId: lecturer.id,
      isPublished: false,
    },
  });
  for (const who of ['a', 'b']) {
    const roll = `9999${String(now).slice(-6)}${who === 'a' ? '01' : '02'}`;
    const user = await prisma.user.create({
      data: {
        name: `${tag} student ${who}`,
        role: 'STUDENT',
        rollNumber: roll,
        password: 'x', // never used: tests authenticate with minted tokens
        studentProfile: { create: { rollNumber: roll, year: 2 } },
      },
    });
    const ws = await prisma.labWorkspace.create({
      data: {
        labId: fx.lab.id,
        studentId: user.id,
        startedAt: new Date(),
        files: { create: { filename: 'main.py', content: `print("${who}")`, language: 'python' } },
      },
      include: { files: true },
    });
    fx[who] = { user, token: tokenFor(user), ws, file: ws.files[0] };
  }
});

after(async () => {
  const labIds = [fx.lab?.id, fx.draft?.id].filter(Boolean);
  await prisma.labFile.deleteMany({ where: { workspace: { labId: { in: labIds } } } });
  await prisma.labWorkspace.deleteMany({ where: { labId: { in: labIds } } });
  await prisma.lab.deleteMany({ where: { id: { in: labIds } } });
  const ids = [fx.a?.user.id, fx.b?.user.id].filter(Boolean);
  await prisma.studentProfile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

const workspaceAction = (who, body) =>
  api('/api/student/workspace', { token: fx[who].token, method: 'POST', body: { labId: fx.lab.id, ...body }, headers: desktopUA });

// ── S6 ──────────────────────────────────────────────────────────────────────────────────
test('S6: a student token cannot list exams through the lecturer endpoint', async () => {
  const r = await api('/api/lecturer/labs', { token: fx.a.token });
  assert.equal(r.status, 403);
  assert.doesNotMatch(JSON.stringify(r.json), /PAPER TEXT/);
});

test('S6 regression: the owning lecturer still lists their exams, including drafts', async () => {
  const r = await api('/api/lecturer/labs', { token: tokenFor(fx.lecturer) });
  assert.equal(r.status, 200);
  const ids = r.json.labs.map((l) => l.id);
  assert.ok(ids.includes(fx.lab.id) && ids.includes(fx.draft.id));
});

test('S6 regression: an admin still lists all exams (admin dashboard uses this endpoint)', async () => {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  const r = await api('/api/lecturer/labs', { token: tokenFor(admin) });
  assert.equal(r.status, 200);
  assert.ok(r.json.labs.some((l) => l.id === fx.lab.id));
});

// ── S12 ─────────────────────────────────────────────────────────────────────────────────
test("S12: a student cannot overwrite another student's file by id", async () => {
  const r = await workspaceAction('a', { action: 'save_file', fileId: fx.b.file.id, content: 'print("tampered")' });
  assert.ok(r.status >= 400, `Expected refusal, got ${r.status}`);
  const after = await prisma.labFile.findUnique({ where: { id: fx.b.file.id } });
  assert.equal(after.content, 'print("b")');
});

test("S12: a student cannot rename or delete another student's file", async () => {
  // Give B a second file so delete is not blocked by the "at least one file" rule.
  const extra = await prisma.labFile.create({ data: { workspaceId: fx.b.ws.id, filename: 'extra.py', content: '', language: 'python' } });
  const ren = await workspaceAction('a', { action: 'rename_file', fileId: extra.id, newFilename: 'owned.py' });
  assert.ok(ren.status >= 400, `rename: expected refusal, got ${ren.status}`);
  const del = await workspaceAction('a', { action: 'delete_file', fileId: extra.id });
  assert.ok(del.status >= 400, `delete: expected refusal, got ${del.status}`);
  const still = await prisma.labFile.findUnique({ where: { id: extra.id } });
  assert.equal(still?.filename, 'extra.py');
});

test('S12 regression: a student can still save, rename and delete their own files', async () => {
  const save = await workspaceAction('a', { action: 'save_file', fileId: fx.a.file.id, content: 'print("mine")' });
  assert.equal(save.status, 200, JSON.stringify(save.json));
  const created = await workspaceAction('a', { action: 'create_file', filename: 'helper.py', content: 'x=1' });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  const ren = await workspaceAction('a', { action: 'rename_file', fileId: created.json.file.id, newFilename: 'util.py' });
  assert.equal(ren.status, 200, JSON.stringify(ren.json));
  const del = await workspaceAction('a', { action: 'delete_file', fileId: created.json.file.id });
  assert.equal(del.status, 200, JSON.stringify(del.json));
});

test('Filename rule: create_file refuses a traversal name', async () => {
  const r = await workspaceAction('a', { action: 'create_file', filename: '../evil.py', content: '' });
  assert.equal(r.status, 400);
});

// ── S5 ──────────────────────────────────────────────────────────────────────────────────
function runJwt(env, snippet) {
  return spawnSync(process.execPath, ['--import', 'tsx', '-e', snippet], {
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  });
}
const SIGN = "import('./src/lib/jwt.ts').then(m=>{try{m.signToken({userId:'u',role:'ADMIN',name:'n'});console.log('SIGNED')}catch(e){console.log('REFUSED')}})";

test('S5: no token is signed when JWT_SECRET is unset', () => {
  const r = runJwt({}, SIGN);
  assert.match(r.stdout, /REFUSED/, r.stdout + r.stderr);
});

test('S5: the historical public fallback secret is refused even if configured', () => {
  const r = runJwt({ JWT_SECRET: 'cbit-labsubmit-super-secret-jwt-key-2026' }, SIGN);
  assert.match(r.stdout, /REFUSED/, r.stdout + r.stderr);
});

test('S5: a token forged with the old fallback secret is rejected by the server', async () => {
  const { default: jwt } = await import('jsonwebtoken');
  const forged = jwt.sign({ userId: fx.lecturer.id, role: 'ADMIN', name: 'x' }, 'cbit-labsubmit-super-secret-jwt-key-2026');
  const r = await api('/api/admin/stats', { token: forged });
  assert.equal(r.status, 401);
});

test('S5 regression: a configured secret signs normally', () => {
  const r = runJwt({ JWT_SECRET: 'a-test-secret-that-is-long-enough-0123456789' }, SIGN);
  assert.match(r.stdout, /SIGNED/, r.stdout + r.stderr);
});
