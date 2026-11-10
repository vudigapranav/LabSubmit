// ExecutionRecord persistence (iteration 6): every student run is recorded however it ends,
// faculty runs are not, the history is faculty-only, and the capture rules are the ones the
// browser terminal uses so an Output section can be checked against a recorded run.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { api, prisma, tokenFor, runOnEngine, WS_URL } from './helpers.mjs';
import { applyTerminalInput, appendBounded, findMatchingRun, stripAnsi, RECORD_FIELD_LIMIT, TRUNCATION_MARKER } from '../src/lib/runTranscript.ts';
import { persistExecutionRecord, MAX_RECORDS_PER_WORKSPACE } from '../src/lib/executionRecords.ts';

const tag = `runrec_${Date.now()}`;
const fx = {};

before(async () => {
  const lecturers = await prisma.user.findMany({ where: { role: 'LECTURER' }, take: 2 });
  [fx.owner, fx.otherLecturer] = lecturers;
  fx.admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  const now = Date.now();
  fx.lab = await prisma.lab.create({
    data: {
      title: `${tag} exam`, description: 'run-record fixture', problemStatement: 'square a number', year: 2,
      lecturerId: fx.owner.id, isPublished: true, allowedLanguages: 'c,python',
      examDate: new Date(now - 60_000), startTime: new Date(now - 60_000), endTime: new Date(now + 3_600_000), durationMinutes: 60,
    },
  });
  const roll = `7777${String(now).slice(-8)}`;
  fx.student = await prisma.user.create({
    data: { name: `${tag} student`, role: 'STUDENT', rollNumber: roll, password: 'x', studentProfile: { create: { rollNumber: roll, year: 2 } } },
  });
  fx.ws = await prisma.labWorkspace.create({ data: { labId: fx.lab.id, studentId: fx.student.id, startedAt: new Date() } });
  fx.token = tokenFor(fx.student);
});

after(async () => {
  await prisma.submission.deleteMany({ where: { labId: fx.lab.id } });
  await prisma.executionRecord.deleteMany({ where: { workspaceId: fx.ws.id } });
  await prisma.labWorkspace.deleteMany({ where: { labId: fx.lab.id } });
  await prisma.lab.delete({ where: { id: fx.lab.id } });
  await prisma.studentProfile.deleteMany({ where: { userId: fx.student.id } });
  await prisma.user.delete({ where: { id: fx.student.id } });
  await prisma.$disconnect();
});

// Records are written after the exit message is sent (the terminal never waits on the DB),
// so poll briefly for the expected count.
async function recordsAfter(expectedCount) {
  for (let i = 0; i < 40; i++) {
    const rows = await prisma.executionRecord.findMany({ where: { workspaceId: fx.ws.id }, orderBy: { createdAt: 'desc' } });
    if (rows.length >= expectedCount) return rows;
    await new Promise((r) => setTimeout(r, 100));
  }
  return prisma.executionRecord.findMany({ where: { workspaceId: fx.ws.id }, orderBy: { createdAt: 'desc' } });
}

// ── Write path ──────────────────────────────────────────────────────────────────────────
test('a successful student run is recorded with stdin, clean output and exit code', async () => {
  const code = '#include <stdio.h>\nint main(){int n;printf("Enter n: ");scanf("%d",&n);printf("square=%d\\n",n*n);return 0;}';
  const r = await runOnEngine({ token: fx.token, labId: fx.lab.id, filename: 'main.c', code, inputs: [{ after: /Enter n: /, data: '7\r' }] });
  assert.equal(r.exitCode, 0, r.output);
  const [rec] = await recordsAfter(1);
  assert.equal(rec.filename, 'main.c');
  assert.equal(rec.language, 'c');
  assert.equal(rec.stdin, '7\n');
  assert.equal(rec.exitCode, 0);
  assert.equal(rec.compileFailed, false);
  assert.ok(rec.durationMs >= 0);
  assert.match(rec.stdout, /square=49/);
  assert.doesNotMatch(rec.stdout, /Program Started|Compilation Successful|Program Finished/, 'platform banners must not be recorded');
  assert.doesNotMatch(rec.stdout, /\x1b/, 'no ANSI escapes');
  // Same text the browser capture produced in STATE.md's recorded verification.
  assert.equal(rec.stdout, 'Enter n: 7\nsquare=49\n');
});

test('a compile failure is recorded with the compiler diagnostics', async () => {
  const before = (await recordsAfter(0)).length;
  await runOnEngine({ token: fx.token, labId: fx.lab.id, filename: 'main.c', code: 'int main(){ return undefined_name; }' });
  const [rec] = await recordsAfter(before + 1);
  assert.equal(rec.compileFailed, true);
  assert.equal(rec.exitCode, 1);
  assert.match(rec.stdout, /undefined_name/);
});

test('a manually stopped run is recorded with no exit code and the input given so far', async () => {
  const before = (await recordsAfter(0)).length;
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    ws.on('open', () =>
      ws.send(JSON.stringify({ type: 'run', filename: 'main.py', code: 'a=input("a? ")\nb=input("b? ")\nprint(a,b)', token: fx.token, labId: fx.lab.id }))
    );
    let out = '';
    let answered = false;
    let stopped = false;
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      // Prompt-driven, not timed: answer the first prompt, stop while the second waits.
      if (m.type === 'output' && !m.system) {
        out += m.data;
        if (!answered && /a\? /.test(out)) {
          answered = true;
          ws.send(JSON.stringify({ type: 'input', data: 'first\r' }));
        }
        if (!stopped && /b\? /.test(out)) {
          stopped = true;
          ws.send(JSON.stringify({ type: 'stop' }));
        }
      }
      if (m.type === 'exit') {
        ws.close();
        resolve();
      }
    });
    ws.on('error', reject);
  });
  const [rec] = await recordsAfter(before + 1);
  assert.equal(rec.exitCode, null);
  assert.equal(rec.stdin, 'first\n');
  assert.match(rec.stdout, /a\? first/);
});

test('a lecturer running code in the inspector creates no student record', async () => {
  const before = await prisma.executionRecord.count();
  const r = await runOnEngine({ token: tokenFor(fx.owner), labId: fx.lab.id, filename: 'main.py', code: 'print("faculty test")' });
  assert.equal(r.exitCode, 0, r.output);
  await new Promise((res) => setTimeout(res, 500));
  assert.equal(await prisma.executionRecord.count(), before);
});

test('a rejected run (unsafe filename) creates no record', async () => {
  const before = (await recordsAfter(0)).length;
  await runOnEngine({ token: fx.token, labId: fx.lab.id, filename: '../x.py', code: 'print(1)' });
  await new Promise((res) => setTimeout(res, 400));
  assert.equal((await recordsAfter(0)).length, before);
});

// ── Read path ───────────────────────────────────────────────────────────────────────────
test('run history is visible to the owning lecturer and admin only', async () => {
  const sub = await prisma.submission.create({ data: { labId: fx.lab.id, studentId: fx.student.id, workspaceId: fx.ws.id } });
  const path = `/api/lecturer/executions?submissionId=${sub.id}`;

  const owner = await api(path, { token: tokenFor(fx.owner) });
  assert.equal(owner.status, 200);
  assert.ok(owner.json.runs.length >= 3);
  const ts = owner.json.runs.map((r) => new Date(r.createdAt).getTime());
  assert.deepEqual(ts, [...ts].sort((a, b) => b - a), 'newest first');

  assert.equal((await api(path, { token: tokenFor(fx.admin) })).status, 200);
  assert.equal((await api(path, { token: tokenFor(fx.otherLecturer) })).status, 404, 'another lecturer must not see it');
  assert.equal((await api(path, { token: fx.token })).status, 403, 'students have no access');
  assert.equal((await api('/api/lecturer/executions?submissionId=does-not-exist', { token: tokenFor(fx.owner) })).status, 404);
  assert.equal((await api('/api/lecturer/executions', { token: tokenFor(fx.owner) })).status, 400);
});

// ── Retention ───────────────────────────────────────────────────────────────────────────
test(`records are capped at ${MAX_RECORDS_PER_WORKSPACE} per workspace, oldest pruned`, async () => {
  const base = Date.now() - 10_000_000;
  await prisma.executionRecord.createMany({
    data: Array.from({ length: MAX_RECORDS_PER_WORKSPACE }, (_, i) => ({
      workspaceId: fx.ws.id, filename: 'old.py', language: 'python', createdAt: new Date(base + i),
    })),
  });
  await persistExecutionRecord(prisma, {
    workspaceId: fx.ws.id, filename: 'newest.py', language: 'python', stdin: '', stdout: 'x'.repeat(RECORD_FIELD_LIMIT + 50),
    exitCode: 0, durationMs: 5, compileFailed: false,
  });
  const rows = await prisma.executionRecord.findMany({ where: { workspaceId: fx.ws.id }, orderBy: { createdAt: 'desc' } });
  assert.equal(rows.length, MAX_RECORDS_PER_WORKSPACE);
  assert.equal(rows[0].filename, 'newest.py');
  assert.ok(rows[0].stdout.endsWith(TRUNCATION_MARKER), 'oversized output is truncated and marked');
  assert.ok(!rows.some((r) => r.createdAt.getTime() === base), 'oldest record pruned');
});

test('a database failure while recording never throws into the run', async () => {
  await persistExecutionRecord(prisma, { workspaceId: 'no-such-workspace', filename: 'a.py', language: 'python', stdin: '', stdout: '', exitCode: 0, durationMs: 1, compileFailed: false });
});

// ── Shared capture rules (pure) ─────────────────────────────────────────────────────────
test('applyTerminalInput: Enter, backspace, arrow keys and pasted multi-line input', () => {
  let s = '';
  for (const k of ['4', '2', '\x7f', '3', '\r']) s = applyTerminalInput(s, k);
  assert.equal(s, '43\n');
  assert.equal(applyTerminalInput('x', '\x1b[A'), 'x', 'arrow key ignored');
  assert.equal(applyTerminalInput('', '3\r4\r'), '3\n4\n', 'pasted lines are captured');
});

test('appendBounded truncates once and marks it', () => {
  const full = appendBounded('', 'a'.repeat(30), 10);
  assert.equal(full, 'a'.repeat(10) + TRUNCATION_MARKER);
  assert.equal(appendBounded(full, 'more', 10), full);
});

test('findMatchingRun ignores trailing whitespace but not content', () => {
  const runs = ['Enter n: 7\nsquare=49\n', 'Enter n: 3\nsquare=9\n'];
  assert.equal(findMatchingRun('Enter n: 3\r\nsquare=9   ', runs), 1);
  assert.equal(findMatchingRun('Enter n: 7\nsquare=50', runs), -1, 'edited output does not match');
  assert.equal(findMatchingRun('   ', runs), -1, 'blank never matches');
  assert.equal(stripAnsi('\x1b[32mok\x1b[0m\r\n'), 'ok\n');
});
