import test from 'node:test';
import assert from 'node:assert/strict';

test('bootShared clears bootP after failure so retry can run again', async () => {
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('../src/shared.js', import.meta.url), 'utf8');
  assert.match(src, /bootP\.catch\(\(\) => \{\s*bootP = null;\s*\}\)/);
  assert.match(src, /SHARED_DOWNLOAD_STALL_MS = 20000/);
  assert.match(src, /bootSharedForUi/);
});

test('Day 4 app blocks on bootShared (no fail-open bootSharedForUi import)', async () => {
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /import\s*\{[^}]*bootSharedForUi/);
  assert.match(src, /await bootShared\(/);
  assert.match(src, /MODEL_DOWNLOAD_STALL_MS/);
});

test('callWorker uses a timeout so hung worker calls cannot block scoreTail forever', async () => {
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('../src/trial.js', import.meta.url), 'utf8');
  assert.match(src, /WORKER_CALL_TIMEOUT_MS = 15000/);
  assert.match(src, /Worker call timed out after/);
  assert.match(src, /workerPending\.delete\(id\)/);
});
