// Regenerates app/std/std_pose.json in headless Chromium: node tools/extract-std.mjs (needs playwright)
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { serveRepo } from './serve-route.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
const b = await chromium.launch({ proxy, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage();
p.on('console', m => console.log('[page]', m.text()));
p.on('pageerror', e => console.log('[err]', e.message));
// Playwright's Chromium has no H.264 decoder, so pass a VP9 copy of the same clip: node tools/extract-std.mjs path/to/standard.webm
const alt = process.argv[2];
await serveRepo(p, root, alt ? { '/alt.webm': alt } : {});
await p.goto('https://site.test/tools/extract-std.html' + (alt ? '?src=/alt.webm' : ''));
await p.waitForFunction(() => window.__out, null, { timeout: 600000 });
writeFileSync(new URL('../app/std/std_pose.json', import.meta.url), await p.evaluate(() => window.__out));
console.log(await p.textContent('#log'));
await b.close();
