import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMP_UNLOCK_ALL,
  buildPathSteps,
  effectiveOpenPathIndex,
  firstOpenPathIndex,
  isBookPathOpen,
  isUnitPathOpen,
  pathLocksActive,
  pathStepIndex,
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

test('teacher start grant opens path ahead of natural progress', () => {
  const steps = buildPathSteps(books, ['basic_a']);
  const ctx = {
    unlockAll: false,
    teacher: false,
    books,
    steps,
    scores: {},
    linePassed: lineNeverPassed,
    teacherPathGrant: { mode: 'start', bookId: 'basic_a', unitId: 'unit02' },
  };
  assert.equal(isUnitPathOpen('basic_a', 'unit01', ctx), true);
  assert.equal(isUnitPathOpen('basic_a', 'unit02', ctx), true);
  assert.equal(pathStepIndex(steps, 'basic_a', 'unit02'), 1);
  assert.equal(
    effectiveOpenPathIndex(steps, books, {}, lineNeverPassed, ctx.teacherPathGrant),
    1,
  );
});

test('teacher open-all grant opens every step', () => {
  const steps = buildPathSteps(books, ['basic_a']);
  const grant = { mode: 'open' };
  const ctx = {
    unlockAll: false,
    teacher: false,
    books,
    steps,
    scores: {},
    linePassed: lineNeverPassed,
    teacherPathGrant: grant,
  };
  assert.equal(isUnitPathOpen('basic_a', 'unit02', ctx), true);
});
