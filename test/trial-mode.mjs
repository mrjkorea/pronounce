import test from 'node:test';
import assert from 'node:assert/strict';
import {
  greedyCitrinetTranscript,
  doorFromTranscript,
  overlapRatio,
  normalizeWords,
  isSilence,
  bootModelPaths,
} from '../src/trial.js';

test('bootModelPaths lists citrinet assets only', () => {
  assert.deepEqual(bootModelPaths(), [
    'models/citrinet/model.int8.onnx',
    'models/citrinet/sp_pieces.json',
  ]);
});

test('doorFromTranscript rejects silence and empty transcript', () => {
  const target = 'It is here';
  const silent = new Float32Array(16000);
  assert.equal(isSilence(silent), true);
  const door = doorFromTranscript(silent, target, '');
  assert.equal(door.ok, false);
});

test('doorFromTranscript accepts close overlap', () => {
  const target = 'How are you';
  const heard = normalizeWords('how are you today').join(' ');
  const samples = new Float32Array(8000).fill(0.1);
  const door = doorFromTranscript(samples, target, heard);
  assert.equal(door.ok, overlapRatio(normalizeWords(target), normalizeWords(heard)) >= 0.5, true);
});

test('greedyCitrinetTranscript skips blank id', () => {
  const vocab = 1025;
  const tokenById = new Map([[1, '\u2581hi']]);
  const flat = new Float32Array(vocab).fill(-20);
  flat[1] = 0;
  const text = greedyCitrinetTranscript(flat, 1, vocab, tokenById);
  assert.equal(text, 'hi');
});
