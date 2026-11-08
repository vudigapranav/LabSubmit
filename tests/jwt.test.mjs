// Token signing/verification and role enforcement (SECURITY_AUDIT.md S5; iteration 4).
// Unit tests import src/lib/jwt.ts directly (npm test loads tsx); HTTP and WebSocket tests
// hit the running server; the startup tests spawn real server processes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { api, prisma, tokenFor, lecturerWithLab, runOnEngine } from './helpers.mjs';
import { signToken, verifyToken, assertJwtSecretConfigured, jwtSecretWarnings, getTokenFromRequest } from '../src/lib/jwt.ts';

const SERVER_SECRET = process.env.JWT_SECRET;
const PUBLISHED = 'cbit-labsubmit-super-secret-jwt-key-2026';
const payload = (role) => ({ userId: `u-${role}`, role, name: `Test ${role}`, email: null, rollNumber: null });

// Each unit test sets the secret it needs; restore the real one so HTTP helpers keep working.
function withSecret(value, fn) {
  const prev = process.env.JWT_SECRET;
  if (value === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = value;
  try {
    return fn();
  } finally {
    process.env.JWT_SECRET = prev;
  }
}
const GOOD = 'unit-test-secret-0123456789-abcdefghijklmnop';

// ── Unit: sign / verify ─────────────────────────────────────────────────────────────────
test('sign → verify round-trips the payload for all three roles', () =>
  withSecret(GOOD, () => {
    for (const role of ['ADMIN', 'LECTURER', 'STUDENT']) {
      const v = verifyToken(signToken(payload(role)));
      assert.equal(v?.role, role);
      assert.equal(v?.userId, `u-${role}`);
      assert.ok(v.exp - v.iat === 7 * 24 * 3600, 'tokens live 7 days');
    }
  }));

test('expired token is rejected', () =>
  withSecret(GOOD, () => {
    const expired = jwt.sign({ ...payload('ADMIN'), exp: Math.floor(Date.now() / 1000) - 10 }, GOOD);
    assert.equal(verifyToken(expired), null);
  }));

test('token signed with a different secret is rejected', () =>
  withSecret(GOOD, () => {
    assert.equal(verifyToken(jwt.sign(payload('ADMIN'), 'some-other-secret-0123456789-abcdef')), null);
  }));

test('tampered payload is rejected (role escalation attempt)', () =>
  withSecret(GOOD, () => {
    const [h, , s] = signToken(payload('STUDENT')).split('.');
    const forgedBody = Buffer.from(JSON.stringify({ ...payload('ADMIN'), iat: 1, exp: 9999999999 })).toString('base64url');
    assert.equal(verifyToken(`${h}.${forgedBody}.${s}`), null);
  }));

test('alg "none" and non-HS256 algorithms are rejected', () =>
  withSecret(GOOD, () => {
    const none = jwt.sign(payload('ADMIN'), '', { algorithm: 'none' });
    assert.equal(verifyToken(none), null);
    const hs512 = jwt.sign(payload('ADMIN'), GOOD, { algorithm: 'HS512' });
    assert.equal(verifyToken(hs512), null);
  }));

test('malformed and empty tokens are rejected without throwing', () =>
  withSecret(GOOD, () => {
    for (const t of ['', 'abc', 'a.b.c', 'Bearer x', '.'.repeat(5)]) assert.equal(verifyToken(t), null);
  }));

test('missing JWT_SECRET: signing throws, verifying fails closed', () => {
  for (const missing of [undefined, '', '   ']) {
    withSecret(missing, () => {
      assert.throws(() => signToken(payload('ADMIN')), /JWT_SECRET is not set/);
      assert.equal(verifyToken(jwt.sign(payload('ADMIN'), GOOD)), null);
      assert.throws(() => assertJwtSecretConfigured(), /not set/);
    });
  }
});

test('the published legacy secret is refused for both signing and verifying', () =>
  withSecret(PUBLISHED, () => {
    assert.throws(() => signToken(payload('ADMIN')), /publicly known/);
    assert.equal(verifyToken(jwt.sign(payload('ADMIN'), PUBLISHED)), null);
  }));

test('a short secret works but produces a warning; a long one does not', () => {
  withSecret('short-secret', () => {
    assert.ok(verifyToken(signToken(payload('LECTURER'))));
    assert.equal(jwtSecretWarnings().length, 1);
  });
  withSecret(GOOD, () => assert.equal(jwtSecretWarnings().length, 0));
});

test('token is read from the Authorization header, then the cookie', () => {
  const h = (headers) => new Request('http://x/', { headers });
  assert.equal(getTokenFromRequest(h({ authorization: 'Bearer abc.def.ghi' })), 'abc.def.ghi');
  assert.equal(getTokenFromRequest(h({ cookie: 'theme=dark; token=xyz.uvw.rst' })), 'xyz.uvw.rst');
  assert.equal(getTokenFromRequest(h({})), null);
});

// ── HTTP: role matrix on the running server ─────────────────────────────────────────────
const tag = `jwttest_${Date.now()}`;
const PASSWORD = 'Role-Matrix-Pass-77';
const fx = {};

before(async () => {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const roll = `8888${String(Date.now()).slice(-8)}`;
  fx.ADMIN = await prisma.user.create({ data: { name: `${tag} admin`, email: `${tag}_a@example.test`, role: 'ADMIN', password: hash } });
  fx.LECTURER = await prisma.user.create({ data: { name: `${tag} lecturer`, email: `${tag}_l@example.test`, role: 'LECTURER', password: hash } });
  fx.STUDENT = await prisma.user.create({
    data: { name: `${tag} student`, rollNumber: roll, role: 'STUDENT', password: hash, studentProfile: { create: { rollNumber: roll, year: 2 } } },
  });
});

after(async () => {
  await prisma.studentProfile.deleteMany({ where: { userId: fx.STUDENT?.id } });
  await prisma.user.deleteMany({ where: { name: { startsWith: tag } } });
  await prisma.$disconnect();
});

test('all three roles sign in with real credentials and receive a verifiable token', async () => {
  const cases = [
    ['ADMIN', fx.ADMIN.email, 'FACULTY'],
    ['LECTURER', fx.LECTURER.email, 'FACULTY'],
    ['STUDENT', fx.STUDENT.rollNumber, 'STUDENT'],
  ];
  for (const [role, identifier, tab] of cases) {
    const r = await api('/api/auth/login', {
      method: 'POST',
      body: { identifier, password: PASSWORD, role: tab },
      headers: { 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.1` },
    });
    assert.equal(r.status, 200, `${role}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.user.role, role);
    const me = await api('/api/auth/me', { token: r.json.token });
    assert.equal(me.status, 200, `${role} /me`);
    assert.equal(jwt.verify(r.json.token, SERVER_SECRET, { algorithms: ['HS256'] }).role, role);
  }
});

test('role matrix: each endpoint family admits exactly its roles', async () => {
  const matrix = [
    ['/api/admin/stats', { ADMIN: 200, LECTURER: 403, STUDENT: 403 }],
    ['/api/lecturer/submissions', { ADMIN: 200, LECTURER: 200, STUDENT: 403 }],
    ['/api/lecturer/labs', { ADMIN: 200, LECTURER: 200, STUDENT: 403 }],
    ['/api/student/labs', { ADMIN: 403, LECTURER: 403, STUDENT: 200 }],
    ['/api/student/grades', { ADMIN: 403, LECTURER: 403, STUDENT: 200 }],
  ];
  for (const [path, expected] of matrix) {
    for (const role of ['ADMIN', 'LECTURER', 'STUDENT']) {
      const r = await api(path, { token: tokenFor(fx[role]) });
      assert.equal(r.status, expected[role], `${role} ${path} → ${r.status}`);
    }
  }
});

test('protected endpoints reject missing, expired, tampered and foreign-secret tokens with 401', async () => {
  const expired = jwt.sign({ userId: fx.ADMIN.id, role: 'ADMIN', name: 'x', exp: Math.floor(Date.now() / 1000) - 5 }, SERVER_SECRET);
  const foreign = jwt.sign({ userId: fx.ADMIN.id, role: 'ADMIN', name: 'x' }, 'not-the-server-secret-0123456789abcdef');
  const [h, , s] = tokenFor(fx.STUDENT).split('.');
  const escalated = `${h}.${Buffer.from(JSON.stringify({ userId: fx.STUDENT.id, role: 'ADMIN', name: 'x' })).toString('base64url')}.${s}`;
  for (const token of [undefined, expired, foreign, escalated, 'garbage']) {
    const r = await api('/api/admin/stats', { token });
    assert.equal(r.status, 401, `token ${String(token).slice(0, 12)}… → ${r.status}`);
  }
});

test('execution engine rejects an expired token before running anything', async () => {
  const { lab } = await lecturerWithLab('python');
  const lect = await prisma.user.findUnique({ where: { id: lab.lecturerId } });
  const expired = jwt.sign({ userId: lect.id, role: 'LECTURER', name: 'x', exp: Math.floor(Date.now() / 1000) - 5 }, SERVER_SECRET);
  const r = await runOnEngine({ token: expired, labId: lab.id, filename: 'main.py', code: 'print("SHOULD_NOT_RUN")' });
  assert.ok(r.errors.some((e) => e.code === 'UNAUTHORIZED'), JSON.stringify(r.errors));
  assert.doesNotMatch(r.output, /SHOULD_NOT_RUN/);
});

// ── Startup: the server refuses to boot without a usable secret ─────────────────────────
// JWT_SECRET is passed as an empty string / published value: @next/env never overrides a
// variable that is already defined, so .env cannot quietly fill it back in.
function bootServer(env, port) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const done = (result) => {
      clearTimeout(timer);
      child.kill('SIGKILL');
      resolve({ ...result, out });
    };
    child.stdout.on('data', (d) => {
      out += d;
      // Validation is all these tests are about; stop before Next needs a build.
      if (/Required configuration validated/.test(out)) done({ started: true, code: null });
    });
    child.stderr.on('data', (d) => (out += d));
    child.on('exit', (code) => done({ started: false, code }));
    const timer = setTimeout(() => done({ started: false, code: 'timeout' }), 90000);
  });
}

test('startup: server exits with an error when JWT_SECRET is empty', { timeout: 100000 }, async () => {
  const r = await bootServer({ JWT_SECRET: '', NODE_ENV: 'production' }, 3191);
  assert.equal(r.started, false, r.out);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /\[STARTUP ERROR\] JWT_SECRET is not set/);
});

test('startup: server exits when JWT_SECRET is the published legacy value', { timeout: 100000 }, async () => {
  const r = await bootServer({ JWT_SECRET: PUBLISHED, NODE_ENV: 'production' }, 3192);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /publicly known/);
});

test('startup regression: server starts normally with the configured secret', { timeout: 100000 }, async () => {
  const r = await bootServer({ NODE_ENV: 'production' }, 3193);
  assert.equal(r.started, true, r.out);
  assert.doesNotMatch(r.out, /STARTUP ERROR/);
});
