import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
const csp = JSON.parse(await fs.readFile('vercel.json', 'utf8')).headers[1].headers.find(h => h.key === 'Content-Security-Policy').value;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (req, res) => {
    try {
        const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        const pages = pathname.startsWith('/frontline/');
        const root = path.resolve(`.artifacts/frontline-2d/build-${pages ? 'pages' : 'root'}`);
        const relative = pages ? pathname.slice('/frontline'.length) : pathname;
        const target = path.resolve(root, '.' + (relative.endsWith('/') ? relative + 'index.html' : relative));
        if (!target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
        const data = await fs.readFile(target);
        res.writeHead(200, { 'content-type': types[path.extname(target)] || 'application/octet-stream', 'content-security-policy': csp, 'cache-control': 'no-store' });
        res.end(data);
    } catch { res.writeHead(404).end(); }
});
server.listen(4188, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
