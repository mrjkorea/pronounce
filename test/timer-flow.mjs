import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PART2_LIMIT_SEC,
  timerSeconds,
  enterPart2,
  normalizeFlow,
  emptyFlow,
  noteAttempt,
  isLocked,
  isFinished,
  studentPassed,
  lineOpenFor,
  stuckIds,
  advanceFlow,
} from '../src/flow.js';

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

test('five misses move on, stay not passed, and do not lock', () => {
  const yellow = { pass: false, scorePct: 55, band: 'yellow', score: 0.55 };
  const red = { pass: false, scorePct: 40, band: 'red', score: 0.4 };
  let flow = emptyFlow();
  for (let i = 0; i < 4; i++) flow = noteAttempt(flow, 'yellow-line', yellow);
  assert.equal(isFinished(flow, 'yellow-line'), false);
  assert.equal(advanceFlow(flow, ['yellow-line'], 1).phase, 'part1');
  flow = noteAttempt(flow, 'yellow-line', yellow);
  flow = noteAttempt(noteAttempt(noteAttempt(noteAttempt(noteAttempt(flow, 'red-line', red), 'red-line', red), 'red-line', red), 'red-line', red), 'red-line', red);
  assert.equal(flow.fails['yellow-line'], 5);
  assert.equal(flow.attempts['yellow-line'].pass, false);
  assert.equal(flow.attempts['yellow-line'].band, 'yellow');
  assert.equal(flow.attempts['yellow-line'].scorePct, 55);
  assert.equal(flow.attempts['red-line'].pass, false);
  assert.equal(flow.attempts['red-line'].band, 'red');
  assert.equal(studentPassed(flow, 'yellow-line'), false);
  assert.equal(studentPassed(flow, 'red-line'), false);
  assert.equal(isLocked(flow, 'yellow-line'), false);
  assert.equal(isFinished(flow, 'yellow-line'), true);
  assert.equal(isFinished(flow, 'red-line'), true);
  assert.equal(lineOpenFor(flow, 'yellow-line'), true);
  assert.deepEqual(stuckIds(flow, ['yellow-line', 'red-line']), []);
  const next = advanceFlow(flow, ['yellow-line', 'red-line'], 2);
  assert.equal(next.phase, 'part2');
  assert.equal(studentPassed(next, 'yellow-line'), false);
  assert.equal(studentPassed(next, 'red-line'), false);
});

test('normalizeFlow upgrades legacy 60/90 limits to 120', () => {
  const raw = {
    phase: 'part2',
    part2: { limitSec: 60, wordCount: 10, startedAt: 0, stoppedAt: 0 },
  };
  assert.equal(normalizeFlow(raw).part2.limitSec, 120);
});
