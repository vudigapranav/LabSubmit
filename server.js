const { loadEnvConfig } = require('@next/env');
loadEnvConfig(process.cwd());

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { WebSocketServer } = require('ws');

let ExecutionControllerClass;
try {
  require('tsx/cjs');
  ExecutionControllerClass = require('./src/lib/execution/ExecutionController').ExecutionController;
  console.log('[SERVER INIT] Successfully loaded ExecutionController module');
} catch (e) {
  try {
    ExecutionControllerClass = require('./src/lib/execution/ExecutionController').ExecutionController;
    console.log('[SERVER INIT] Successfully loaded ExecutionController module (fallback)');
  } catch (err) {
    console.error('[SERVER INIT ERROR] Failed to load ExecutionController:', err);
  }
}

const dev = process.env.NODE_ENV !== 'production';

// Required configuration, checked before the server listens. Without this a host with no
// JWT_SECRET started normally and only failed at the first sign-in — and the execution
// engine on this process would reject every run. Refusing to start makes the
// misconfiguration impossible to miss. The rule itself lives in src/lib/jwt.ts so the
// REST layer and this check can never disagree. (Vercel does not run this file; there the
// same rule is enforced on every sign/verify.)
{
  const problems = [];
  if (!process.env.DATABASE_URL) problems.push('DATABASE_URL is not set.');
  try {
    const jwtModule = require('./src/lib/jwt');
    jwtModule.assertJwtSecretConfigured();
    jwtModule.jwtSecretWarnings().forEach((w) => console.warn(`[STARTUP WARNING] ${w}`));
    // Not fatal (existing deployments keep working), but without it hand-ins and audit rows are
    // only hash-protected, which someone with database write access can recompute.
    if (!process.env.INTEGRITY_KEY || process.env.INTEGRITY_KEY.length < 32) {
      console.warn('[STARTUP WARNING] INTEGRITY_KEY is not set (32+ chars): submission snapshots and audit rows will be UNSIGNED.');
    }
  } catch (err) {
    problems.push(err && err.message ? err.message : String(err));
  }
  if (problems.length > 0) {
    problems.forEach((p) => console.error(`[STARTUP ERROR] ${p}`));
    console.error('[STARTUP ERROR] Refusing to start. Set the missing values in .env (local) or the host environment (Railway).');
    process.exit(1);
  }
  console.log('[STARTUP] Required configuration validated.');
  try {
    const { describeIsolation } = require('./src/lib/execution/sandbox');
    console.log(`[STARTUP] Execution isolation: ${describeIsolation()}`);
  } catch (err) {
    console.error('[STARTUP] Could not determine execution isolation:', err && err.message);
  }
}
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('[HTTP ERROR]', req.url, err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });

  // maxPayload: the ws default is 100 MB per message. A run carries at most 1 MB of source
  // (enforced in ExecutionController), so 2 MB covers it with JSON overhead; anything larger
  // closes the socket with 1009 before it is buffered and parsed (SECURITY_AUDIT.md S15).
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = parse(request.url || '', true);
    if (pathname === '/api/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
    // In development, other upgrades (Next's HMR at /_next/webpack-hmr) must be left alone.
    // In production nothing else legitimately upgrades, so close them: an unanswered upgrade
    // otherwise hangs open indefinitely, and Next 14.x has an unpatched SSRF advisory for
    // WebSocket upgrades on custom servers (SECURITY_AUDIT.md S8).
    else if (!dev) {
      socket.destroy();
    }
  });

  wss.on('connection', (ws, request) => {
    console.log('[STAGE: WS CONNECTED] Client connected to PTY WebSocket endpoint');

    // The upgrade request's headers are forwarded so the controller can apply the same
    // server-side exam-device restriction the REST routes do. A phone cannot reach the
    // execution engine directly to sidestep the check in /api/student/workspace.
    const controller = new ExecutionControllerClass(ws, request && request.headers);

    ws.on('message', async (data) => {
      console.log(`[STAGE: WS MESSAGE] Received ${data.length} bytes`);
      await controller.handleMessage(data);
    });

    ws.on('close', async (code, reason) => {
      console.log(`[STAGE: WS CLOSED] Code: ${code}, Reason: ${reason || 'none'}`);
      await controller.handleDisconnect();
    });

    ws.on('error', async (err) => {
      console.error('[STAGE: WS SOCKET ERROR]', err.message);
      await controller.handleDisconnect();
    });
  });

  server.listen(port, () => {
    console.log(`> LabSubmit Platform Server active on http://${hostname}:${port}`);
    console.log(`> Execution Engine WebSocket endpoint active on ws://${hostname}:${port}/api/ws`);
  });
});
