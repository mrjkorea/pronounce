/**
 * Headless Chrome: every hear/image/audio path used by the app returns 200 locally;
 * loading the app triggers zero requests to day4-speak.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { collectHearAssetPaths } from './hear-asset-paths.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.txt': 'text/plain',
};

function staticServer() {
  return createServer(async (req, res) => {
    try {
      const path = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = path === '/' ? '/index.html' : path;
      const file = join(root, rel.replace(/^\//, ''));
      const body = await readFile(file);
      const ext = extname(file);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
}

const paths = await collectHearAssetPaths();
const server = staticServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/`;

const bad = [];
for (const rel of paths) {
  const url = base + rel;
  const res = await fetch(url);
  if (res.status !== 200) bad.push({ rel, status: res.status });
}
if (bad.length) {
  console.error('Missing or bad assets:', bad.slice(0, 20), bad.length > 20 ? `…+${bad.length - 20}` : '');
  process.exit(1);
}
console.log(`fetch ok: ${paths.size} assets`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const external = [];
page.on('request', (req) => {
  const u = req.url();
  if (u.includes('day4-speak')) external.push(u);
});
await page.goto(base + 'index.html', { waitUntil: 'networkidle' });
await page.evaluate(() => {
  window.dispatchEvent(new Event('mrj-auth-ready'));
});
await page.waitForTimeout(500);
if (external.length) {
  console.error('day4-speak requests:', external);
  process.exit(1);
}
console.log('playwright: zero day4-speak requests on load');
await browser.close();
server.close();
console.log('verify-hear-assets: ok');
