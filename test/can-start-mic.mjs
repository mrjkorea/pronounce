import test from 'node:test';
import assert from 'node:assert/strict';
import { canStartMic } from '../src/flow.js';

const phases = ['part1', 'teacher', 'part2'];

test('canStartMic allows the next mic while a grade is running', () => {
  for (const phase of phases) {
    assert.equal(canStartMic({
      phase,
      recording: false,
      grading: true,
      timerRunning: true,
      lineOpen: true,
    }), true, phase);
  }
});

test('canStartMic blocks while a take is recording', () => {
  for (const phase of phases) {
    assert.equal(canStartMic({
      phase,
      recording: true,
      grading: true,
      timerRunning: true,
      lineOpen: true,
    }), false, phase);
  }
});
