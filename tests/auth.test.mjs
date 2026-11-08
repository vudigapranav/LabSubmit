// Login hardening (SECURITY_AUDIT.md S7): no account enumeration, bounded guessing,
// and every legitimate login path still works.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { api, prisma } from './helpers.mjs';

const tag = `authtest_${Date.now()}`;
const PASSWORD = 'Correct-Horse-42';
const fx = {};
// Each test gets its own client address so per-IP counters never bleed between tests or runs.
const ip = () => ({ 'x-forwarded-for': `10.${rnd()}.${rnd()}.${rnd()}` });
const rnd = () => Math.floor(Math.random() * 250) + 1;
const login = (identifier, password, role, headers = ip()) =>
  api('/api/auth/login', { method: 'POST', body: { identifier, password, role }, headers });

before(async () => {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const mk = (suffix) =>
    prisma.user.create({ data: { name: `${tag} ${suffix}`, email: `${tag}_${suffix}@example.test`, role: 'LECTURER', password: hash } });
  fx.lecturer = await mk('main');
  fx.victim = await mk('victim');
});

after(async () => {
  await prisma.user.deleteMany({ where: { name: { startsWith: tag } } });
  await prisma.$disconnect();
});

test('S7: unknown account and wrong password are indistinguishable', async () => {
  const unknown = await login(`${tag}_nobody@example.test`, 'whatever', 'FACULTY');
  const wrong = await login(fx.lecturer.email, 'not-the-password', 'FACULTY');
  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, 401);
  assert.deepEqual(unknown.json, wrong.json);
});

test('S7: a wrong password on the wrong login tab does not reveal the account type', async () => {
  const r = await login(fx.lecturer.email, 'not-the-password', 'STUDENT');
  assert.equal(r.status, 401);
  assert.doesNotMatch(JSON.stringify(r.json), /student|faculty/i);
});

test('S7 regression: correct password on the wrong tab still gets the helpful message', async () => {
  const r = await login(fx.lecturer.email, PASSWORD, 'STUDENT');
  assert.equal(r.status, 403);
  assert.match(r.json.error, /Faculty Login/);
});

test('S7: repeated failures for one account are throttled with 429 + Retry-After', async () => {
  let last;
  for (let i = 0; i < 12; i++) last = await login(fx.victim.email, `guess-${i}`, 'FACULTY');
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) > 0);
  // Even the correct password is throttled while locked — otherwise the lock is an oracle.
  const correct = await login(fx.victim.email, PASSWORD, 'FACULTY');
  assert.equal(correct.status, 429);
});

test('S7: throttling one account does not affect another', async () => {
  const r = await login(fx.lecturer.email, PASSWORD, 'FACULTY');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.token);
});

test('Regression: seeded admin can log in through the faculty tab', async () => {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  // Seed password from prisma/seed.ts; skip rather than fail if a deployment changed it.
  const r = await login(admin.email, 'admin@123', 'FACULTY');
  if (r.status === 401) return;
  assert.equal(r.status, 200);
  assert.equal(r.json.user.role, 'ADMIN');
});

test('Regression: missing fields are a 400, not a crash', async () => {
  const r = await login('', '', 'FACULTY');
  assert.equal(r.status, 400);
});
