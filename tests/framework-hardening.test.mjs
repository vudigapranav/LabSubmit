// Framework-level hardening for unpatched Next.js 14.x advisories (SECURITY_AUDIT.md S8).
// Both behaviours are production-only, so this file boots its own production server from
// the existing build (`npm run build` first). It skips — loudly — when no build exists.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import WebSocket from 'ws';

const PORT = 3194;
const BASE = `http://localhost:${PORT}`;
const hasBuild = fs.existsSync('.next/BUILD_ID');
let child;

before(async () => {
  if (!hasBuild) return;
  child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let out = '';
    const t = setTimeout(() => reject(new Error(`production server did not start:\n${out}`)), 90000);
    const on = (d) => {
      out += d;
      if (/WebSocket endpoint active/.test(out)) {
        clearTimeout(t);
        resolve();
      }
    };
    child.stdout.on('data', on);
    child.stderr.on('data', on);
  });
});

after(() => child?.kill('SIGKILL'));

const opts = { skip: hasBuild ? false : 'no production build in .next — run `npm run build` first' };

test('S8: the image optimisation endpoint is disabled', opts, async () => {
  const res = await fetch(`${BASE}/_next/image?url=%2Fcbit-logo.png&w=64&q=75`);
  assert.notEqual(res.status, 200, 'optimizer still serving');
});

test('S8 regression: the logo is still served directly', opts, async () => {
  const res = await fetch(`${BASE}/cbit-logo.png`);
  assert.equal(res.status, 200);
  const html = await (await fetch(`${BASE}/login`)).text();
  assert.match(html, /src="\/cbit-logo\.png"/, 'login page should reference the logo directly');
});

test('S8: a WebSocket upgrade to any path other than /api/ws is closed promptly', opts, async () => {
  const outcome = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/some/other/path`);
    const t = setTimeout(() => {
      ws.terminate();
      resolve('still open after 3s');
    }, 3000);
    ws.on('open', () => resolve('opened'));
    ws.on('error', () => {
      clearTimeout(t);
      resolve('closed');
    });
  });
  assert.equal(outcome, 'closed');
});

test('S8 regression: the execution WebSocket still upgrades in production', opts, async () => {
  const opened = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/api/ws`);
    ws.on('open', () => {
      ws.close();
      resolve(true);
    });
    ws.on('error', () => resolve(false));
  });
  assert.equal(opened, true);
});
