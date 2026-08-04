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

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = parse(request.url || '', true);
    if (pathname === '/api/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
    // Note: Do NOT call socket.destroy() here so Next.js HMR /_next/webpack-hmr and other upgrade handlers work properly!
  });

  wss.on('connection', (ws) => {
    console.log('[STAGE: WS CONNECTED] Client connected to PTY WebSocket endpoint');

    const controller = new ExecutionControllerClass(ws);

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
