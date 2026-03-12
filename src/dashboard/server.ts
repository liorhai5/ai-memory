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

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
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
  dbPath: string;
  open: boolean;
  staticDir: string;
}

export function startDashboard(opts: DashboardOptions): void {
  const ctx = createApp(opts.dbPath);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
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

  server.listen(opts.port, () => {
    const url = `http://localhost:${opts.port}`;
    console.log(`ai-memory dashboard running at ${url}`);

    if (opts.open) {
      const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${cmd} ${url}`, () => {});
    }
  });
}
