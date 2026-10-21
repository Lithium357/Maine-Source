import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const port = Number(process.env.PORT || 4318);
http.createServer(async (req, res) => {
  if (new URL(req.url, 'http://localhost').pathname === '/') { res.writeHead(302, { Location: '/ui/index.html' + new URL(req.url, 'http://localhost').search }); return res.end(); }
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(root, '.' + (relative === '/' ? '/ui/index.html' : relative));
  if (!file.startsWith(root + path.sep) || !['ui', 'src'].some(dir => file.startsWith(path.join(root, dir) + path.sep))) { res.writeHead(403); return res.end(); }
  try { const data = await readFile(file); res.setHeader('Content-Type', ({ '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript' })[path.extname(file)] || 'text/plain'); res.end(data); } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`UI preview (simulated data): http://127.0.0.1:${port}/?preview=1`));
