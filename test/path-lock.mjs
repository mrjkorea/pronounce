import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMP_UNLOCK_ALL,
  buildPathSteps,
  firstOpenPathIndex,
  isBookPathOpen,
  isUnitPathOpen,
  pathLocksActive,
} from '../src/path-lock.js';

const books = [{
  id: 'basic_a',
  units: [{ id: 'unit01' }, { id: 'unit02' }],
}];

function lineNeverPassed() {
  return false;
}

test('TEMP_UNLOCK_ALL disables path locks for students', () => {
  assert.equal(TEMP_UNLOCK_ALL, true);
  assert.equal(pathLocksActive({ teacher: false }), false);
  const ctx = {
    teacher: false,
    books,
    steps: buildPathSteps(books, ['basic_a']),
    scores: {},
    linePassed: lineNeverPassed,
  };
  assert.equal(isUnitPathOpen('basic_a', 'unit02', ctx), true);
  assert.equal(isBookPathOpen('basic_a', ctx), true);
});

test('sequential unit path when unlockAll is false', () => {
  const steps = buildPathSteps(books, ['basic_a']);
  const ctx = {
    unlockAll: false,
    teacher: false,
    books,
    steps,
    scores: {},
    linePassed: lineNeverPassed,
  };
  assert.equal(pathLocksActive(ctx), true);
  assert.equal(pathLocksActive({ ...ctx, teacher: true }), false);
  assert.equal(isUnitPathOpen('basic_a', 'unit01', ctx), true);
  assert.equal(isUnitPathOpen('basic_a', 'unit02', ctx), false);
  assert.equal(firstOpenPathIndex(steps, books, {}, lineNeverPassed), 0);
});
