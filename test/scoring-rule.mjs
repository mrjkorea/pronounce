import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_THRESHOLDS, PASS_PCT, bandForScore } from '../src/engine.js';
import { mergeRetryResult } from '../src/trial.js';

test('all apps: green 75+, yellow 50-74, red under 50', () => {
  for (const id of ['day4', 'day6', 'phonics', 'decodables', 'toeic', 'default']) {
    assert.deepEqual({ ...APP_THRESHOLDS[id] }, { green: 75, yellow: 50 }, id);
    assert.equal(bandForScore(75, id), 'green');
    assert.equal(bandForScore(74, id), 'yellow');
    assert.equal(bandForScore(50, id), 'yellow');
    assert.equal(bandForScore(49, id), 'red');
  }
});

test('pass = line average >= 60 (yellow alone does not pass)', () => {
  assert.equal(PASS_PCT, 60);
  const w = (word, score) => ({ word, score, band: bandForScore(score), pass: score >= 60 });
  const prev = { words: [w('it', 40), w('is', 40)] };
  const r59 = mergeRetryResult(prev, { words: [w('it', 58), w('is', 60)] }, 'it is', 'day4');
  assert.equal(r59.scorePct, 59); assert.equal(r59.band, 'yellow'); assert.equal(r59.pass, false);
  const r60 = mergeRetryResult(prev, { words: [w('it', 60), w('is', 60)] }, 'it is', 'day4');
  assert.equal(r60.pass, true); assert.equal(r60.band, 'yellow');
});
