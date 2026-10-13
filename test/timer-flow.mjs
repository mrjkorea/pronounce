import test from 'node:test';
import assert from 'node:assert/strict';
import { PART2_LIMIT_SEC, timerSeconds, enterPart2, normalizeFlow } from '../src/flow.js';

test('timerSeconds is always 120 seconds', () => {
  assert.equal(timerSeconds(0), PART2_LIMIT_SEC);
  assert.equal(timerSeconds(10), PART2_LIMIT_SEC);
  assert.equal(timerSeconds(80), PART2_LIMIT_SEC);
  assert.equal(PART2_LIMIT_SEC, 120);
});

test('enterPart2 stores the fixed limit', () => {
  const flow = enterPart2({ phase: 'part1', fails: {}, student: {}, attempts: {}, teacher: {}, rushRecorded: {}, rushGrades: {}, part2: {} }, 42);
  assert.equal(flow.part2.limitSec, 120);
});

test('normalizeFlow upgrades legacy 60/90 limits to 120', () => {
  const raw = {
    phase: 'part2',
    part2: { limitSec: 60, wordCount: 10, startedAt: 0, stoppedAt: 0 },
  };
  assert.equal(normalizeFlow(raw).part2.limitSec, 120);
});
