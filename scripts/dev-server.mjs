import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import worker from '../history-api/worker.mjs';

const pagePath = fileURLToPath(new URL('../index.html', import.meta.url));
const host = '127.0.0.1', port = Number(process.env.PORT || 4173);
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${host}:${port}`);
    if (url.pathname.startsWith('/api/history')) {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 128 * 1024) { res.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      const method = req.method;
      const response = await worker.fetch(new Request(url, { method, headers: req.headers, ...(!['GET', 'HEAD'].includes(method) ? { body: Buffer.concat(chunks) } : {}) }), {
        ...process.env,
        ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || `http://${host}:${port},http://localhost:${port}`
      });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (!['/', '/index.html'].includes(url.pathname) || req.method !== 'GET') { res.writeHead(404).end(); return; }
    let html = await readFile(pagePath, 'utf8');
    if (process.env.GITHUB_TOKEN) html = html.replace(/<meta name="history-api" content="[^"]*">/, `<meta name="history-api" content="http://${host}:${port}/api/history">`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  } catch { res.writeHead(500).end('Local server error'); }
}).listen(port, host, () => console.log(`Kiosk order: http://${host}:${port}/`));
