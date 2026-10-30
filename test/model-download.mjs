import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_MODEL_BYTES,
  fetchPartWithProgress,
  DOWNLOAD_STALL_USER_MESSAGE,
} from '../src/trial.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'models/hubert/manifest.json'), 'utf8'));

test('EXPECTED_MODEL_BYTES matches models/hubert/manifest.json totalBytes', () => {
  assert.equal(EXPECTED_MODEL_BYTES, manifest.totalBytes);
});

test('fetchPartWithProgress rejects when download stalls with no bytes', async () => {
  const stallMs = 80;
  const fetchImpl = () =>
    Promise.resolve({
      ok: true,
      body: {
        getReader() {
          return {
            read: () => new Promise(() => {}),
          };
        },
      },
    });

  await assert.rejects(
    () => fetchPartWithProgress('https://example.test/part-00.bin', fetchImpl, { stallMs }),
    (err) => {
      assert.equal(err.message, DOWNLOAD_STALL_USER_MESSAGE);
      return true;
    },
  );
});

test('fetchPartWithProgress reports incremental bytes across chunks', async () => {
  const chunks = [new Uint8Array(100), new Uint8Array(50)];
  let i = 0;
  const fetchImpl = () =>
    Promise.resolve({
      ok: true,
      body: {
        getReader() {
          return {
            read: async () => {
              if (i >= chunks.length) return { done: true, value: undefined };
              return { done: false, value: chunks[i++] };
            },
          };
        },
      },
    });

  let seen = 0;
  const out = await fetchPartWithProgress('https://example.test/part.bin', fetchImpl, {
    stallMs: 60000,
    onPartBytes: (n) => {
      seen += n;
    },
  });
  assert.equal(seen, 150);
  assert.equal(out.byteLength, 150);
});
