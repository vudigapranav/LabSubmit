// Server-authoritative exam clock (iteration 12). The browser regression for skewed client
// clocks (±15 min) is a Chrome check — see ENGINEERING_CHANGELOG.md; these pin the contract.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, prisma, tokenFor } from './helpers.mjs';
import { estimateClockOffset, serverRemainingMs } from '../src/lib/serverClock.ts';

after(() => prisma.$disconnect());

test('offset: a client clock 15 minutes fast is corrected by -15 minutes', () => {
  const serverNow = Date.parse('2026-11-08T10:00:00Z');
  const skew = 15 * 60_000;
  const sent = serverNow + skew - 100; // client stamps in its own (fast) clock
  const received = serverNow + skew + 100; // 200 ms round trip, server stamped the midpoint
  assert.equal(estimateClockOffset(new Date(serverNow).toISOString(), sent, received), -skew);
});

test('offset: latency only costs half the round trip in accuracy', () => {
  const serverNow = Date.parse('2026-11-08T10:00:00Z');
  // Server actually stamped right at the start of a slow 4 s round trip.
  const off = estimateClockOffset(new Date(serverNow).toISOString(), serverNow, serverNow + 4000);
  assert.ok(Math.abs(off) <= 2000, `offset error ${off} ms`);
});

test('offset: unusable inputs give null (keep the previous offset)', () => {
  assert.equal(estimateClockOffset(undefined, 0, 1), null);
  assert.equal(estimateClockOffset('not a date', 0, 1), null);
  assert.equal(estimateClockOffset(new Date().toISOString(), 10, 5), null);
});

test('remaining time uses the corrected clock', () => {
  const deadline = '2026-11-08T10:10:00Z';
  const fastLocal = Date.parse('2026-11-08T10:15:00Z'); // 15 min fast: looks past the deadline
  assert.equal(serverRemainingMs(deadline, -15 * 60_000, fastLocal), 10 * 60_000);
});

test('exam API responses carry the server clock (GET, start_exam, heartbeat)', async () => {
  const lect = await prisma.user.findFirst({ where: { role: 'LECTURER' } });
  const now = Date.now();
  const lab = await prisma.lab.create({ data: { title: `timer_${now}`, description: 'd', problemStatement: 'p', year: 2, lecturerId: lect.id, isPublished: true, allowedLanguages: 'python', durationMinutes: 60, examDate: new Date(now - 60000), startTime: new Date(now - 60000), endTime: new Date(now + 3600000) } });
  const roll = `5050${String(now).slice(-8)}`;
  const s = await prisma.user.create({ data: { name: `timer_${now}`, role: 'STUDENT', rollNumber: roll, password: 'x', studentProfile: { create: { rollNumber: roll, year: 2 } } } });
  const headers = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
  try {
    const close = (iso) => Math.abs(Date.parse(iso) - Date.now()) < 5000;
    const g = await api(`/api/student/workspace?labId=${lab.id}`, { token: tokenFor(s), headers });
    assert.ok(close(g.json.serverNow), `GET serverNow ${g.json.serverNow}`);
    const st = await api('/api/student/workspace', { token: tokenFor(s), method: 'POST', body: { labId: lab.id, action: 'start_exam', sessionId: 'sess-timer' }, headers });
    assert.equal(st.status, 200, JSON.stringify(st.json));
    assert.ok(close(st.json.serverNow));
    const hb = await api('/api/student/heartbeat', { token: tokenFor(s), method: 'POST', body: { labId: lab.id, sessionId: 'sess-timer' } });
    assert.ok(close(hb.json.serverNow), JSON.stringify(hb.json));
  } finally {
    await prisma.labWorkspace.deleteMany({ where: { labId: lab.id } });
    await prisma.lab.delete({ where: { id: lab.id } });
    await prisma.studentProfile.deleteMany({ where: { userId: s.id } });
    await prisma.user.delete({ where: { id: s.id } });
  }
});
