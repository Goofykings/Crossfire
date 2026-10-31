import { createServer, type IncomingMessage, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { MESSAGE_LIMIT, parseClientMessage, parseServerMessage, PROTOCOL_VERSION, PUBLIC_ROOM, type ServerMessage } from '../../shared/protocol';

// Export the actual shared validators for compatibility checks, not a fork of the protocol.
export { parseClientMessage, parseServerMessage, PROTOCOL_VERSION };

export interface Settings { host: string; port: number; allowedOrigins: string[] }
export function settingsFromEnv(env: NodeJS.ProcessEnv): Settings {
  const host = env.DEDICATED_HOST?.trim() || '127.0.0.1';
  const rawPort = env.DEDICATED_PORT?.trim() || '8788';
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DEDICATED_PORT must be an integer between 1 and 65535.');
  }
  const values = (env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((s) => s.trim());
  if (!values.length || values.some((value) => {
    try {
      const url = new URL(value);
      return !['http:', 'https:'].includes(url.protocol) || url.origin !== value || !!url.username || !!url.password;
    } catch { return true; }
  })) throw new Error('ALLOWED_ORIGINS must be a comma-separated list of exact http(s) origins, without paths or wildcards.');
  return { host, port, allowedOrigins: values };
}

function respondJson(res: import('node:http').ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

/** Incomplete transport scaffold: it never creates sessions or simulates players. */
export function createDedicatedServer(settings: Settings): { server: Server; sockets: WebSocketServer } {
  const server = createServer((req, res) => {
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    if (req.url === '/health') {
      respondJson(res, 200, { ok: true, ready: false, service: 'crossfire-dedicated-scaffold', protocol: PROTOCOL_VERSION,
        room: PUBLIC_ROOM, detail: 'Authoritative multiplayer is not implemented.' });
    } else if (req.url === '/presence') {
      respondJson(res, 503, { error: 'Dedicated multiplayer is not implemented.' });
    } else if (req.url === '/ws') {
      res.writeHead(426, { Upgrade: 'websocket' }).end('WebSocket upgrade required');
    } else res.writeHead(404).end();
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MESSAGE_LIMIT });
  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    socket.on('error', () => {});
    if (req.method !== 'GET' || req.url !== '/ws') { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return; }
    if (!req.headers.origin || !settings.allowedOrigins.includes(req.headers.origin)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) => sockets.emit('connection', ws, req));
  });
  sockets.on('connection', (ws: WebSocket) => {
    let answered = false;
    const timeout = setTimeout(() => ws.close(1008, 'handshake_timeout'), 5000);
    ws.on('error', () => {});
    ws.on('close', () => clearTimeout(timeout));
    ws.on('message', (data: RawData, binary: boolean) => {
      if (answered) return;
      answered = true;
      clearTimeout(timeout);
      const raw = data.toString();
      let version: unknown;
      try { version = (JSON.parse(raw) as { v?: unknown } | null)?.v; } catch { /* parser rejects malformed JSON */ }
      const message = binary ? null : parseClientMessage(raw);
      const incompatible = typeof version === 'number' && version !== PROTOCOL_VERSION;
      const response: ServerMessage = { v: PROTOCOL_VERSION, type: 'error', fatal: true,
        code: incompatible ? 'protocol_mismatch' : message ? 'server_incomplete' : 'invalid_message',
        message: incompatible ? `Protocol mismatch: expected v${PROTOCOL_VERSION}.`
          : message ? 'Dedicated server is incomplete; authoritative multiplayer is not available.' : 'Invalid protocol message.' };
      ws.send(JSON.stringify(response), () => ws.close(1008, response.code));
    });
  });
  return { server, sockets };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const settings = settingsFromEnv(process.env);
    const { server } = createDedicatedServer(settings);
    server.listen(settings.port, settings.host, () => console.log(
      `Crossfire dedicated scaffold listening on http://${settings.host}:${settings.port}; multiplayer is not implemented.`));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
