// Minimal static server for the exported app (e2e + local preview). Serves
// only files under the root; no directory listing.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

/**
 * Start serving `root`.
 * @returns The listening server (port 0 picks a free port).
 */
export function serve(root, port = 0) {
  const base = resolve(root);
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    let file = normalize(join(base, path));
    if (file !== base && !file.startsWith(base + sep)) { res.writeHead(403).end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    else if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
    if (!existsSync(file)) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise(ok => server.listen(port, '127.0.0.1', () => ok(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = await serve(process.argv[2] ?? 'out', Number(process.env.PORT ?? 3000));
  console.log(`Serving on http://127.0.0.1:${server.address().port}`);
}
