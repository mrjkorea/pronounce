import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendAttempt,
  bestLabel,
  bestScoreOf,
  hasAttempt,
  nextTryNo,
  pageIdFor,
  readStore,
  recordFor,
  writeStore,
} from '../src/attempts.js';
import { emptyFlow, normalizeFlow, retryFlow } from '../src/flow.js';

const PAGE = pageIdFor('basic_a', 'unit01');

function finished(store, n, score, pass, extra = {}) {
  return appendAttempt(store, PAGE, {
    n,
    startedAt: `2026-11-0${n}T10:00:00+09:00`,
    endedAt: `2026-11-0${n}T10:05:00+09:00`,
    score,
    pass,
    correct: Math.round(score / 10),
    total: 20,
    missed: [],
    source: 'student',
    ...extra,
  });
}

test('first finished try is kept as try 1 with the first and last dates', () => {
  const store = finished(readStore('{}'), 1, 90, true);
  const rec = recordFor(store, PAGE);
  assert.equal(rec.attemptCount, 1);
  assert.equal(rec.firstDoneAt, '2026-11-01T10:05:00+09:00');
  assert.equal(rec.lastAttemptAt, '2026-11-01T10:05:00+09:00');
  assert.equal(rec.bestScore, 90);
  assert.equal(rec.pass, true);
  assert.equal(rec.attempts.length, 1);
});

test('a second try is appended, never overwrites try 1', () => {
  let store = finished(readStore('{}'), 1, 90, true);
  store = finished(store, 2, 70, false);
  const rec = recordFor(store, PAGE);
  assert.equal(rec.attemptCount, 2);
  assert.deepEqual(rec.attempts.map((a) => a.n), [1, 2]);
  assert.deepEqual(rec.attempts.map((a) => a.score), [90, 70]);
  assert.equal(rec.firstDoneAt, '2026-11-01T10:05:00+09:00', 'first date kept');
  assert.equal(rec.lastAttemptAt, '2026-11-02T10:05:00+09:00', 'last date moves forward');
  assert.equal(rec.bestScore, 90, 'a lower retry never lowers the best');
  assert.equal(rec.pass, true, 'a failed retry never removes the pass');
});

test('a higher retry raises the best and the best label names its try', () => {
  let store = finished(readStore('{}'), 1, 60, true);
  store = finished(store, 2, 95, true);
  assert.equal(bestScoreOf(store, PAGE), 95);
  assert.equal(bestLabel(store, PAGE), 'Best 95% (try 2)');
});

test('the same try number never doubles after a reload', () => {
  let store = finished(readStore('{}'), 1, 80, true);
  store = finished(store, 1, 50, false);
  const rec = recordFor(store, PAGE);
  assert.equal(rec.attemptCount, 1);
  assert.equal(rec.attempts[0].score, 80, 'the kept row wins');
  assert.equal(hasAttempt(store, PAGE, 1), true);
  assert.equal(hasAttempt(store, PAGE, 2), false);
});

test('store round-trips through JSON', () => {
  let store = finished(readStore('{}'), 1, 80, true);
  store = finished(store, 2, 85, true);
  const again = readStore(writeStore(store));
  assert.equal(recordFor(again, PAGE).attemptCount, 2);
  assert.equal(nextTryNo(again, PAGE), 3);
});

test('an older single-result record is read as try 1', () => {
  const store = readStore(JSON.stringify({
    [PAGE]: { firstDoneAt: '2026-10-01T09:00:00+09:00', bestScore: 77, pass: true, attempts: undefined, tries: 1 },
  }));
  const rec = recordFor(store, PAGE);
  assert.equal(rec.bestScore, 77);
  assert.equal(rec.pass, true);
  assert.notEqual(typeof rec.attempts, 'undefined');
  assert.equal(Array.isArray(rec.attempts), true);
  assert.equal(nextTryNo(store, PAGE), 2);
});

test('broken JSON never throws', () => {
  assert.deepEqual(readStore('not json'), {});
});

test('retryFlow starts a new numbered try and keeps teacher passes', () => {
  const flow = Object.assign(emptyFlow(), {
    phase: 'results',
    tryNo: 1,
    tryStartedAt: 1000,
    student: { a: { pass: true } },
    attempts: { a: { pass: true } },
    fails: { b: 2 },
    rushGrades: { a: { pass: true } },
    teacher: { c: 'passed' },
  });
  const next = retryFlow(flow, 5000);
  assert.equal(next.phase, 'part1');
  assert.equal(next.tryNo, 2);
  assert.equal(next.tryStartedAt, 5000);
  assert.deepEqual(next.teacher, { c: 'passed' }, 'teacher pass kept');
  assert.deepEqual(next.student, {}, 'the sheet starts again from the first line');
  assert.deepEqual(next.rushGrades, {});
  assert.deepEqual(next.attempts, {});
  assert.deepEqual(next.fails, {});
});

test('tryNo and tryStartedAt survive normalizeFlow', () => {
  const raw = normalizeFlow({ phase: 'part1', tryNo: 3, tryStartedAt: 42 });
  assert.equal(raw.tryNo, 3);
  assert.equal(raw.tryStartedAt, 42);
  assert.equal(normalizeFlow({}).tryNo, 1);
});
