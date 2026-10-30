import test from 'node:test';
import assert from 'node:assert/strict';

test('bootShared clears bootP after failure so retry can run again', async () => {
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('../src/shared.js', import.meta.url), 'utf8');
  assert.match(src, /bootP\.catch\(\(\) => \{\s*bootP = null;\s*\}\)/);
  assert.match(src, /SHARED_DOWNLOAD_STALL_MS = 20000/);
  assert.match(src, /bootSharedForUi/);
});
