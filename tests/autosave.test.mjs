// Autosave contract (iteration 14): versioned saves refuse to overwrite newer work; crash-recovery
// restores a local draft only onto the exact server version it was based on.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, prisma, tokenFor } from './helpers.mjs';
import { reconcileDraft } from '../src/lib/useFileAutosave.ts';

after(() => prisma.$disconnect());
const headers = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };

test('reconcileDraft: restore only onto the version the draft was based on', () => {
  const server = { id: 'f', content: 'server', updatedAt: '2026-11-08T10:00:00.000Z' };
  assert.equal(reconcileDraft(server, { content: 'draft', base: '2026-11-08T10:00:00.000Z', at: 1 }), 'restore');
  assert.equal(reconcileDraft(server, { content: 'draft', base: '2026-11-08T09:00:00.000Z', at: 1 }), 'discard', 'server changed since');
  assert.equal(reconcileDraft(server, { content: 'draft', base: null, at: 1 }), 'discard', 'unknown base is never trusted');
  assert.equal(reconcileDraft(server, { content: 'server', base: 'x', at: 1 }), 'none');
  assert.equal(reconcileDraft(server, null), 'none');
});

test('save_file: correct base saves; stale base is refused with 409 and changes nothing; no base keeps legacy behaviour', async () => {
  const lect = await prisma.user.findFirst({ where: { role: 'LECTURER' } });
  const now = Date.now();
  const lab = await prisma.lab.create({ data: { title: `autosave_api_${now}`, description: 'd', problemStatement: 'p', year: 2, lecturerId: lect.id, isPublished: true, allowedLanguages: 'python', durationMinutes: 60, examDate: new Date(now - 60000), startTime: new Date(now - 60000), endTime: new Date(now + 3600000) } });
  const roll = `1919${String(now).slice(-8)}`;
  const s = await prisma.user.create({ data: { name: `autosave_api_${now}`, role: 'STUDENT', rollNumber: roll, password: 'x', studentProfile: { create: { rollNumber: roll, year: 2 } } } });
  const ws = await prisma.labWorkspace.create({ data: { labId: lab.id, studentId: s.id, startedAt: new Date(), files: { create: [{ filename: 'main.py', language: 'python', content: 'v0' }] } }, include: { files: true } });
  const file = ws.files[0];
  const save = (content, baseUpdatedAt) => api('/api/student/workspace', { token: tokenFor(s), method: 'POST', headers, body: { labId: lab.id, action: 'save_file', fileId: file.id, content, ...(baseUpdatedAt !== undefined ? { baseUpdatedAt } : {}) } });
  try {
    const first = await save('v1', file.updatedAt.toISOString());
    assert.equal(first.status, 200, JSON.stringify(first.json));
    const v1At = first.json.file.updatedAt;
    assert.notEqual(v1At, file.updatedAt.toISOString(), 'version advances');

    // A delayed save still based on v0 must not overwrite v1.
    const stale = await save('late v0 edit', file.updatedAt.toISOString());
    assert.equal(stale.status, 409, JSON.stringify(stale.json));
    assert.equal(stale.json.conflict, true);
    assert.equal((await prisma.labFile.findUnique({ where: { id: file.id } })).content, 'v1');

    const next = await save('v2', v1At);
    assert.equal(next.status, 200);

    const legacy = await save('no base', undefined);
    assert.equal(legacy.status, 200, 'clients without a base keep last-write-wins');
  } finally {
    await prisma.labWorkspace.deleteMany({ where: { labId: lab.id } });
    await prisma.lab.delete({ where: { id: lab.id } });
    await prisma.studentProfile.deleteMany({ where: { userId: s.id } });
    await prisma.user.delete({ where: { id: s.id } });
  }
});
