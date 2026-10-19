import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_THRESHOLDS, PASS_PCT, bandForScore } from '../src/engine.js';

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
  assert.equal(bandForScore(59), 'yellow');
  assert.equal(59 >= PASS_PCT, false);
  assert.equal(bandForScore(60), 'yellow');
  assert.equal(60 >= PASS_PCT, true);
  assert.equal(bandForScore(74), 'yellow');
  assert.equal(bandForScore(75), 'green');
});
