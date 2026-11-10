// Security assessment module (iterations 8–10): exam-content access, request size limits,
// WebSocket abuse limits, process cleanup, password policy, headers, information exposure.
// Each test is the attempted abuse; a pass means the abuse failed against the running server.
// No denial-of-service volumes are used — sizes and counts are just over each limit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import bcrypt from 'bcryptjs';
import { api, prisma, tokenFor, WS_URL, BASE_URL, runOnEngine } from './helpers.mjs';
import { checkPasswordPolicy } from '../src/lib/passwordPolicy.ts';

const tag = `secmod_${Date.now()}`;
const PAPER = `${tag} CONFIDENTIAL PAPER: reverse a linked list`;
const desktop = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36' };
const fx = {};

before(async () => {
  const cse2 = await prisma.branch.findFirst({ where: { year: 2 } });
  const cse1 = await prisma.branch.findFirst({ where: { year: 1 } });
  fx.lecturer = await prisma.user.findFirst({ where: { role: 'LECTURER' } });
  const now = Date.now();
  const base = { description: 'fixture', problemStatement: PAPER, year: 2, branchId: cse2.id, lecturerId: fx.lecturer.id, isPublished: true, allowedLanguages: 'python', durationMinutes: 60 };
  fx.running = await prisma.lab.create({ data: { ...base, title: `${tag} running`, examDate: new Date(now - 60_000), startTime: new Date(now - 60_000), endTime: new Date(now + 3_600_000) } });
  fx.upcoming = await prisma.lab.create({ data: { ...base, title: `${tag} upcoming`, examDate: new Date(now + 86_400_000), startTime: new Date(now + 86_400_000), endTime: new Date(now + 90_000_000) } });
  const mk = async (suffix, year, branchId) => {
    const roll = `3333${String(now).slice(-6)}${suffix}`;
    return prisma.user.create({
      data: { name: `${tag} ${suffix}`, role: 'STUDENT', rollNumber: roll, password: await bcrypt.hash('Initial-Pass-1', 10), studentProfile: { create: { rollNumber: roll, year, branchId } } },
    });
  };
  fx.eligible = await mk('01', 2, cse2.id);
  fx.outsider = await mk('02', 1, cse1.id);
});

after(async () => {
  const labs = [fx.running?.id, fx.upcoming?.id].filter(Boolean);
  await prisma.submission.deleteMany({ where: { labId: { in: labs } } });
  await prisma.labWorkspace.deleteMany({ where: { labId: { in: labs } } });
  await prisma.lab.deleteMany({ where: { id: { in: labs } } });
  const ids = [fx.eligible?.id, fx.outsider?.id].filter(Boolean);
  await prisma.studentProfile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

const getWorkspace = (who, lab) => api(`/api/student/workspace?labId=${lab.id}`, { token: tokenFor(who), headers: desktop });
const action = (who, lab, body) => api('/api/student/workspace', { token: tokenFor(who), method: 'POST', body: { labId: lab.id, ...body }, headers: desktop });

// ── S13: exam content access ────────────────────────────────────────────────────────────
test('S13: a student outside the exam cohort cannot open it or read the paper', async () => {
  const r = await getWorkspace(fx.outsider, fx.running);
  assert.equal(r.status, 404);
  assert.doesNotMatch(JSON.stringify(r.json), /CONFIDENTIAL PAPER/);
  assert.equal(await prisma.labWorkspace.count({ where: { labId: fx.running.id, studentId: fx.outsider.id } }), 0, 'no workspace created');
});

test('S13: the paper of an UPCOMING exam is not readable before it starts', async () => {
  const r = await getWorkspace(fx.eligible, fx.upcoming);
  assert.equal(r.status, 200);
  assert.doesNotMatch(JSON.stringify(r.json), /CONFIDENTIAL PAPER/);
});

test('S13: a running exam\'s paper is withheld until the student starts their own clock', async () => {
  const before = await getWorkspace(fx.eligible, fx.running);
  assert.equal(before.status, 200);
  assert.doesNotMatch(JSON.stringify(before.json), /CONFIDENTIAL PAPER/, 'paper visible before Start');
  const start = await action(fx.eligible, fx.running, { action: 'start_exam' });
  assert.equal(start.status, 200, JSON.stringify(start.json));
  assert.match(start.json.problemStatement, /CONFIDENTIAL PAPER/, 'start_exam must deliver the paper');
  const afterStart = await getWorkspace(fx.eligible, fx.running);
  assert.match(afterStart.json.lab.problemStatement, /CONFIDENTIAL PAPER/, 'reload after start must show the paper');
});

test('S13: start_exam refuses a student outside the cohort even with a workspace', async () => {
  // A workspace that predates the cohort check (or was made by hand) must not be startable.
  await prisma.labWorkspace.create({ data: { labId: fx.running.id, studentId: fx.outsider.id } });
  const r = await action(fx.outsider, fx.running, { action: 'start_exam' });
  assert.equal(r.status, 403);
  assert.doesNotMatch(JSON.stringify(r.json), /CONFIDENTIAL PAPER/);
});

// ── S14: request size limits ────────────────────────────────────────────────────────────
test('S14: an oversized source file is refused; a normal one is saved', async () => {
  const ws = await prisma.labWorkspace.findFirst({ where: { labId: fx.running.id, studentId: fx.eligible.id }, include: { files: true } });
  const fileId = ws.files[0].id;
  const big = await action(fx.eligible, fx.running, { action: 'save_file', fileId, content: 'x'.repeat(600 * 1024) });
  assert.equal(big.status, 413, `got ${big.status}`);
  const ok = await action(fx.eligible, fx.running, { action: 'save_file', fileId, content: 'print("hello")' });
  assert.equal(ok.status, 200);
});

test('S14: an oversized answer-sheet section is refused', async () => {
  const section = await prisma.answerSheetSection.create({ data: { labId: fx.running.id, key: 'AIM', label: 'Aim', order: 1 } });
  const r = await action(fx.eligible, fx.running, { action: 'save_section', sectionId: section.id, content: 'y'.repeat(200 * 1024) });
  assert.equal(r.status, 413, `got ${r.status}`);
  const ok = await action(fx.eligible, fx.running, { action: 'save_section', sectionId: section.id, content: 'To study recursion.' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
});

test('S14: a workspace cannot grow beyond the per-attempt file limit', async () => {
  let last;
  for (let i = 0; i < 25; i++) {
    last = await action(fx.eligible, fx.running, { action: 'create_file', filename: `f${i}.py`, content: '' });
    if (last.status !== 200) break;
  }
  assert.equal(last.status, 400, 'file limit should stop creation');
  assert.ok((await prisma.labFile.count({ where: { workspace: { labId: fx.running.id, studentId: fx.eligible.id } } })) <= 20);
});

// ── S15: WebSocket limits ───────────────────────────────────────────────────────────────
function openRun(token, labId, code) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, { headers: desktop });
    const seen = { ws, errors: [], running: false, closed: null };
    ws.on('open', () => ws.send(JSON.stringify({ type: 'run', filename: 'main.py', code, token, labId })));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'error') seen.errors.push(m.code);
      if (m.type === 'status' && m.status === 'running') {
        seen.running = true;
        resolve(seen);
      }
      if (m.type === 'exit' && !seen.running) resolve(seen);
    });
    ws.on('close', (code) => {
      seen.closed = code;
      resolve(seen);
    });
    ws.on('error', reject);
  });
}

test('S15: one user cannot run more than 2 programs at once', async () => {
  const token = tokenFor(fx.eligible);
  const waitForever = 'input("waiting")';
  const runs = [];
  for (let i = 0; i < 3; i++) runs.push(await openRun(token, fx.running.id, waitForever));
  try {
    assert.equal(runs.filter((r) => r.running).length, 2, `running: ${runs.map((r) => r.running)}`);
    assert.ok(runs[2].errors.includes('TOO_MANY_RUNS'), JSON.stringify(runs[2].errors));
  } finally {
    runs.forEach((r) => r.ws.close());
  }
  // Slots are released on disconnect: a new run is accepted afterwards.
  await new Promise((r) => setTimeout(r, 500));
  const again = await openRun(token, fx.running.id, 'print(1)');
  again.ws.close();
  assert.ok(!again.errors.includes('TOO_MANY_RUNS'), 'slot not released after disconnect');
});

test('S15: an oversized WebSocket message closes the connection', async () => {
  const closedWith = await new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, { headers: desktop });
    ws.on('open', () => ws.send('x'.repeat(4 * 1024 * 1024)));
    ws.on('close', (code) => resolve(code));
    ws.on('error', () => {});
    setTimeout(() => reject(new Error('connection stayed open')), 10000);
  });
  assert.equal(closedWith, 1009, 'expected 1009 Message Too Big');
});

// ── S16: background processes do not outlive the run ───────────────────────────────────
test('S16: a hangup-immune child process left running by a program is killed when the run ends', async () => {
  const pidFile = path.join(process.cwd(), `.${tag}.pid`);
  // A harmless sleeper in the same process group, then the program exits normally.
  // The child ignores SIGHUP — the signal a terminal sends its process group when the
  // program exits — as a deliberately lingering student program would.
  const code = `import subprocess, signal\np = subprocess.Popen(["sleep", "120"], preexec_fn=lambda: signal.signal(signal.SIGHUP, signal.SIG_IGN))\nprint("CHILD", p.pid)`;
  const token = tokenFor(fx.eligible);
  const out = await new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, { headers: desktop });
    let text = '';
    ws.on('open', () => ws.send(JSON.stringify({ type: 'run', filename: 'main.py', code, token, labId: fx.running.id })));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'output') text += m.data;
      if (m.type === 'exit') {
        ws.close();
        resolve(text);
      }
    });
    ws.on('error', reject);
  });
  const pid = Number((out.match(/CHILD (\d+)/) || [])[1]);
  assert.ok(pid > 0, out);
  await new Promise((r) => setTimeout(r, 800));
  // The liveness probe runs INSIDE the engine (a second run), because the PID belongs to the
  // engine's process namespace. This used to call process.kill(pid, 0) — and SIGKILL on a
  // match — on the machine running the tests: against Docker that signalled whichever
  // unrelated host process had the same number. Nothing here ever signals a host process.
  // Signal 0 only checks existence: ESRCH = gone; EPERM = alive under another pooled uid.
  const probe = await runOnEngine({
    token,
    labId: fx.running.id,
    filename: 'main.py',
    code: `import os\ntry:\n    os.kill(${pid}, 0)\n    print("STATE alive")\nexcept ProcessLookupError:\n    print("STATE gone")\nexcept PermissionError:\n    print("STATE alive")\n`,
  });
  fs.rmSync(pidFile, { force: true });
  const state = (probe.programOutput.match(/STATE (\w+)/) || [])[1];
  assert.equal(state, 'gone', `child ${pid} survived the run (probe said: ${probe.output})`);
});

// ── S17: security headers ───────────────────────────────────────────────────────────────
test('S17: pages refuse framing and set protective headers', async () => {
  const res = await fetch(`${BASE_URL}/login`);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.match(res.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(res.headers.get('referrer-policy'));
  assert.equal(res.headers.get('x-powered-by'), null);
});

// ── S18: password policy ────────────────────────────────────────────────────────────────
test('S18: password policy rule', () => {
  assert.ok(checkPasswordPolicy('short1'));
  assert.ok(checkPasswordPolicy('é'.repeat(40)), 'over 72 bytes (bcrypt would silently truncate)');
  assert.ok(checkPasswordPolicy(12345678), 'not a string');
  assert.equal(checkPasswordPolicy('Good-pass-9'), null);
});

test('S18: weak passwords are refused on change and on admin reset', async () => {
  const weak = await api('/api/profile', { token: tokenFor(fx.eligible), method: 'PUT', body: { currentPassword: 'Initial-Pass-1', newPassword: '1' } });
  assert.equal(weak.status, 400, JSON.stringify(weak.json));
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  const reset = await api('/api/admin/students/reset-password', { token: tokenFor(admin), method: 'POST', body: { userId: fx.eligible.id, newPassword: 'abc' } });
  assert.equal(reset.status, 400, JSON.stringify(reset.json));
  assert.ok(await bcrypt.compare('Initial-Pass-1', (await prisma.user.findUnique({ where: { id: fx.eligible.id } })).password), 'password unchanged');
});

// ── S10 / S11: information exposure ─────────────────────────────────────────────────────
test('S10: the lecturer directory is not public', async () => {
  assert.equal((await api('/api/auth/lecturers-available')).status, 401);
  assert.equal((await api('/api/auth/lecturers-available', { token: tokenFor(fx.eligible) })).status, 403);
});

test('S11: no route returns raw exception messages to the client', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'route.ts' && /NextResponse\.json\(\{\s*error:\s*(error|err)\.message/.test(fs.readFileSync(p, 'utf8'))) offenders.push(p);
    }
  };
  walk('src/app/api');
  assert.deepEqual(offenders, []);
});

// ── S23: a lecturer may only create/move exams into subjects they teach ─────────────────
test('S23: a lecturer cannot create or move an exam into another lecturer\'s subject', async () => {
  const [mine, theirs] = await Promise.all([
    prisma.subject.findFirst({ where: { lecturerId: { not: null } }, include: { lecturer: true } }),
    null,
  ]);
  const foreign = await prisma.subject.findFirst({ where: { lecturerId: { not: mine.lecturerId } } });
  assert.ok(mine && foreign, 'needs two subjects with different lecturers in the seed');
  const token = tokenFor(mine.lecturer);
  const day = new Date(Date.now() + 2 * 86_400_000);
  const at = (h) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h).toISOString();
  const body = (s) => ({
    title: `${tag} s23`, description: 'd', problemStatement: 'p', year: s.year, branchId: s.branchId, subjectId: s.id,
    allowedLanguages: ['python'], examDate: at(0), startTime: at(10), endTime: at(12), durationMinutes: 60,
  });

  const intoForeign = await api('/api/lecturer/labs', { token, method: 'POST', body: body(foreign) });
  assert.equal(intoForeign.status, 403, JSON.stringify(intoForeign.json));
  assert.equal(await prisma.lab.count({ where: { title: `${tag} s23` } }), 0);

  const own = await api('/api/lecturer/labs', { token, method: 'POST', body: body(mine) });
  assert.equal(own.status, 200, JSON.stringify(own.json));
  const created = own.json.lab;
  try {
    const move = await api('/api/lecturer/labs', { token, method: 'PUT', body: { id: created.id, subjectId: foreign.id, branchId: foreign.branchId, year: foreign.year } });
    assert.equal(move.status, 403, JSON.stringify(move.json));
    assert.equal((await prisma.lab.findUnique({ where: { id: created.id } })).subjectId, mine.id);
    // Cohort must match the subject's: no exam for Year 1 under a Year 2 subject.
    const mismatch = await api('/api/lecturer/labs', { token, method: 'POST', body: { ...body(mine), year: mine.year === 1 ? 2 : 1 } });
    assert.equal(mismatch.status, 400, JSON.stringify(mismatch.json));
  } finally {
    await prisma.answerSheetSection.deleteMany({ where: { labId: created.id } });
    await prisma.lab.deleteMany({ where: { title: `${tag} s23` } });
  }
});
