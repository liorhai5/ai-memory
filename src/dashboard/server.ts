import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { exec } from 'node:child_process';
import { createApp } from '../app.js';
import { handleRpc } from './rpc.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

// No CORS headers. The client is served by this same server, so it is already
// same-origin in production, and the vite dev server proxies /rpc rather than
// calling across origins. A wildcard Allow-Origin here meant any page the user
// happened to visit could POST to localhost and read their whole memory back.
function corsHeaders(): Record<string, string> {
  return {};
}

/** Hostname out of a Host header, port removed. `[::1]:8485` -> `::1`.
 *  Returns null when the header is missing or empty — HTTP/1.1 requires it,
 *  and a request without one has nothing to check. */
export function parseHostHeader(raw: string | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v.startsWith('[')) {
    // IPv6 literal: the address itself contains colons, so the port can only
    // be the part after the closing bracket. Splitting on ':' would yield '['.
    const end = v.indexOf(']');
    return end === -1 ? null : v.slice(1, end);
  }
  return v.split(':')[0];
}

export function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/** Loopback is not a security boundary on its own: an attacker's DNS name can
 *  resolve to 127.0.0.1, and the browser then treats their page as same-origin
 *  (DNS rebinding). So while bound to loopback, requests must also be addressed
 *  to a loopback name.
 *
 *  When the operator has deliberately bound a routable interface, they have
 *  opted into exposure and the check is skipped — otherwise --host would be
 *  inert, rejecting every request that reached the interface it opened. */
export function hostAllowed(hostHeader: string | undefined, bindHost: string): boolean {
  if (!isLoopbackHost(bindHost)) return true;
  const host = parseHostHeader(hostHeader);
  return host !== null && isLoopbackHost(host);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function serveStatic(staticDir: string, urlPath: string, res: ServerResponse): void {
  let filePath = join(staticDir, urlPath === '/' ? 'index.html' : urlPath);

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    // SPA fallback
    filePath = join(staticDir, 'index.html');
    if (!existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Dashboard client not built. Run: npm run build:dashboard');
      return;
    }
  }

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
  const body = readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': contentType, ...corsHeaders() });
  res.end(body);
}

export interface DashboardOptions {
  port: number;
  /** Interface to bind. Defaults to loopback — this serves the full
   *  conversation history with no authentication, so it must not be reachable
   *  from the network unless the user explicitly asks for it. */
  host?: string;
  dbPath: string;
  open: boolean;
  staticDir: string;
}

export function startDashboard(opts: DashboardOptions): void {
  const ctx = createApp(opts.dbPath);
  // Without an explicit host, node binds every interface (`::`), which put the
  // full conversation history on the local network with no authentication.
  const host = opts.host ?? '127.0.0.1';

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (!hostAllowed(req.headers.host, host)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden: dashboard is reachable on loopback only');
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url === '/rpc') {
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body);
        const { method, params } = parsed;
        if (!method || typeof method !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders() });
          res.end(JSON.stringify({ ok: false, error: 'Missing "method" field' }));
          return;
        }
        const result = handleRpc(method, params ?? {}, ctx);
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders() });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders() });
        res.end(JSON.stringify({ ok: false, error: String(err) }));
      }
      return;
    }

    if (req.method === 'GET') {
      const urlPath = (req.url ?? '/').split('?')[0];
      serveStatic(opts.staticDir, urlPath, res);
      return;
    }

    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method not allowed');
  });

  const shutdown = () => {
    console.log('\nShutting down dashboard...');
    try {
      ctx.db.close();
    } catch {
      // no-op
    }
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  server.on('error', (err: NodeJS.ErrnoException) => {
    try {
      ctx.db.close();
    } catch {
      // no-op
    }

    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${opts.port} is already in use.`);
      console.error(`Stop the existing process or run: ai-memory dashboard --port ${opts.port + 1}`);
      process.exit(1);
    }

    console.error(`Failed to start dashboard server: ${err.message}`);
    process.exit(1);
  });

  server.listen(opts.port, host, () => {
    const url = `http://localhost:${opts.port}`;
    console.log(`ai-memory dashboard running at ${url}`);

    if (opts.open) {
      const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${cmd} ${url}`, () => {});
    }
  });
}
