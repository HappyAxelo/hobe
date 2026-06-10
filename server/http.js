// Minimal HTTP framework on node:http. Zero dependencies on purpose:
// the npm-less install story matters for a project that must run anywhere,
// and an MVP doesn't need more router than this.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
};

export function createApp() {
  const routes = []; // { method, parts, handler }
  const statics = []; // { prefix, dir, maxAge }

  function add(method, pattern, handler) {
    routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const segs = url.pathname.split('/').filter(Boolean);

    // API routes
    for (const r of routes) {
      if (r.method !== req.method || r.parts.length !== segs.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < segs.length; i++) {
        if (r.parts[i].startsWith(':')) params[r.parts[i].slice(1)] = decodeURIComponent(segs[i]);
        else if (r.parts[i] !== segs[i]) { ok = false; break; }
      }
      if (!ok) continue;
      req.params = params;
      req.query = Object.fromEntries(url.searchParams);
      try {
        if (req.headers['content-type']?.includes('application/json')) {
          req.body = await readJson(req);
        }
        await r.handler(req, res);
      } catch (e) {
        if (!res.headersSent) sendJson(res, e.status ?? 500, { error: e.message });
        if (!e.status) console.error(e);
      }
      return;
    }

    // Static files (with Range support for video seeking on slow links)
    for (const s of statics) {
      if (!url.pathname.startsWith(s.prefix)) continue;
      const rel = decodeURIComponent(url.pathname.slice(s.prefix.length)) || 'index.html';
      const file = path.join(s.dir, rel);
      if (!file.startsWith(s.dir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
      return sendFile(req, res, file, s.maxAge);
    }
    sendJson(res, 404, { error: 'Not found' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => { console.error(e); if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' }); });
  });

  return {
    get: (p, h) => add('GET', p, h),
    post: (p, h) => add('POST', p, h),
    static: (prefix, dir, maxAge = 3600) => statics.push({ prefix, dir: path.resolve(dir), maxAge }),
    listen: (port, cb) => server.listen(port, cb),
    server,
  };
}

function readJson(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

export function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

export function sendFile(req, res, file, maxAge) {
  const stat = fs.statSync(file);
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': `public, max-age=${maxAge}`,
  };
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range && (range[1] || range[2])) {
    const start = range[1] ? parseInt(range[1]) : Math.max(stat.size - parseInt(range[2]), 0);
    const end = range[1] && range[2] ? Math.min(parseInt(range[2]), stat.size - 1) : stat.size - 1;
    if (start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    fs.createReadStream(file).pipe(res);
  }
}
