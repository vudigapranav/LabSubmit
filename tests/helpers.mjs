// Shared helpers for the LabSubmit integration tests.
//
// These tests drive a REAL running server (node server.js) against a REAL local
// PostgreSQL database and real compilers. Nothing is mocked: a passing test is evidence
// about the actual system, which is the point of having them.
//
// Required: the server running at LABSUBMIT_BASE_URL (default http://localhost:3100) with the
// same .env as these tests, and a seeded database (npm run db:seed).
import nextEnv from '@next/env';
import jwt from 'jsonwebtoken';
import WebSocket from 'ws';
import { PrismaClient } from '@prisma/client';

nextEnv.loadEnvConfig(process.cwd());

export const BASE_URL = process.env.LABSUBMIT_BASE_URL || 'http://localhost:3100';
export const WS_URL = BASE_URL.replace(/^http/, 'ws') + '/api/ws';
export const prisma = new PrismaClient();

// Tokens are minted with the server's own secret so tests can act as any seeded user
// without depending on seed passwords. The secret never leaves this process.
export function tokenFor(user) {
  return jwt.sign(
    { userId: user.id, role: user.role, name: user.name, email: user.email, rollNumber: user.rollNumber },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );
}

// A lecturer and one of their own labs that allows the given language. The lecturer path
// in authorizeRun() is used for engine tests because it does not depend on an exam being
// inside its time window — the engine behaviour under test is identical for both roles.
export async function lecturerWithLab(language) {
  const labs = await prisma.lab.findMany({ include: { lecturer: true } });
  const lab = labs.find((l) => (l.allowedLanguages || '').split(',').map((s) => s.trim()).includes(language));
  if (!lab) throw new Error(`No seeded lab allows "${language}". Run npm run db:seed or create one.`);
  return { lab, token: tokenFor(lab.lecturer) };
}

// Runs one program through the execution WebSocket and resolves with everything the
// server sent. `inputs` are written to the program's stdin once it reports "running".
export function runOnEngine({ token, labId, filename, code, files = [], inputs = [], timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, {
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) LabSubmitTest/1.0' },
    });
    const result = { output: '', programOutput: '', errors: [], exitCode: null };
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`Engine run timed out. Output so far:\n${result.output}`));
    }, timeoutMs);

    ws.on('open', () => ws.send(JSON.stringify({ type: 'run', filename, code, files, token, labId })));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'output') {
        result.output += msg.data;
        if (!msg.system) result.programOutput += msg.data;
      } else if (msg.type === 'error') {
        result.errors.push(msg);
      } else if (msg.type === 'status' && msg.status === 'running') {
        // Small delay so the program has reached its read() before input arrives.
        inputs.forEach((data, i) => setTimeout(() => ws.send(JSON.stringify({ type: 'input', data })), 300 * (i + 1)));
      } else if (msg.type === 'exit') {
        result.exitCode = msg.exitCode;
        clearTimeout(timer);
        ws.close();
        resolve(result);
      }
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

export async function api(path, { token, method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json, headers: res.headers };
}
