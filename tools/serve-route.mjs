// Serves the repo to a Playwright page under https://site.test/ (no local server needed).
import { readFileSync, existsSync, statSync } from 'fs';
import { extname, join } from 'path';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.css': 'text/css', '.svg': 'image/svg+xml', '.webm': 'video/webm' };
export async function serveRepo(page, root, extra = {}) {
  await page.route('https://site.test/**', route => {
    let path = decodeURIComponent(new URL(route.request().url()).pathname);
    let f = extra[path] || join(root, path); if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
    if (!existsSync(f)) return route.fulfill({ status: 404, body: 'nf' });
    const body = readFileSync(f), type = TYPES[extname(f)] || 'application/octet-stream';
    const range = route.request().headers()['range'];
    if (range) {
      const [a, b] = range.replace('bytes=', '').split('-'); const s = +a, e = b ? +b : body.length - 1;
      return route.fulfill({ status: 206, body: body.subarray(s, e + 1), headers: { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${s}-${e}/${body.length}` } });
    }
    return route.fulfill({ status: 200, body, headers: { 'content-type': type, 'accept-ranges': 'bytes' } });
  });
}
