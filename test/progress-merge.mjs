import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authStudentId,
  mergeScoreMaps,
  mergeScoreRecord,
  packLoadAllowsSave,
  parsePackJson,
  progressRowsToScores,
  studentScoreStorageKey,
  loadStudentScoresOnly,
  LEGACY_SCORE_KEY,
} from '../src/progress-merge.js';

test('authStudentId accepts string or {id} student values', () => {
  assert.equal(authStudentId('Jay'), 'Jay');
  assert.equal(authStudentId({ id: 'student-1' }), 'student-1');
  assert.equal(authStudentId({}), '');
  assert.equal(authStudentId(null), '');
});

test('studentScoreStorageKey is per-student and normalized', () => {
  assert.equal(studentScoreStorageKey('Jay'), 'day4-pronounce-scores-v2:jay');
  assert.equal(studentScoreStorageKey('  Jay  '), 'day4-pronounce-scores-v2:jay');
});

test('mergeScoreRecord keeps max scorePct and earliest attempt timestamp', () => {
  const a = { scorePct: 40, score: 0.4, pass: false, at: 100, english: 'a' };
  const b = { scorePct: 70, score: 0.7, pass: true, at: 200, english: 'b' };
  const merged = mergeScoreRecord(a, b);
  assert.equal(merged.scorePct, 70);
  assert.equal(merged.pass, true);
  assert.equal(merged.at, 100);
});

test('mergeScoreMaps never drops richer local when remote is empty', () => {
  const local = { x: { scorePct: 55, score: 0.55, pass: false, at: 1 } };
  const merged = mergeScoreMaps(local, {});
  assert.equal(merged.x.scorePct, 55);
  assert.equal(merged.x.at, 1);
});

test('parsePackJson treats unparseable server JSON as empty without throwing', () => {
  const bad = parsePackJson('{not json');
  assert.equal(bad.unparseable, true);
  assert.deepEqual(bad.scores, {});
});

test('progressRowsToScores filters program on old mixed progress payloads', () => {
  const rows = [
    { program: 'other', item: 'a', scorePct: 99 },
    { program: 'pronounce', item: 'item-1', scorePct: 80 },
    { program: 'pronounce', itemId: 'pronounce:item-2', scoreValue: 50, scoreMax: 100 },
  ];
  const scores = progressRowsToScores(rows);
  assert.equal(Object.keys(scores).length, 2);
  assert.equal(scores['item-1'].scorePct, 80);
  assert.equal(scores['item-2'].scorePct, 50);
});

test('packLoadAllowsSave gates remote saves', () => {
  assert.equal(packLoadAllowsSave({ ok: true }), true);
  assert.equal(packLoadAllowsSave({ ok: false }), false);
  assert.equal(packLoadAllowsSave(null), false);
});

test('legacy device-wide scores are never merged into a student key or save payload', () => {
  const storage = new Map();
  const api = {
    getItem(k) { return storage.has(k) ? storage.get(k) : null; },
    setItem(k, v) { storage.set(k, v); },
  };
  storage.set(LEGACY_SCORE_KEY, JSON.stringify({
    student_a_line: { scorePct: 99, score: 0.99, pass: true, at: 1 },
    student_b_line: { scorePct: 88, score: 0.88, pass: true, at: 2 },
  }));
  const studentKey = studentScoreStorageKey('student_a');
  assert.equal(api.getItem(studentKey), null);

  const local = loadStudentScoresOnly(api, 'student_a');
  assert.deepEqual(local, {});

  const afterServer = mergeScoreMaps(local, {
    real_line: { scorePct: 50, score: 0.5, pass: false, at: 3 },
  });
  api.setItem(studentKey, JSON.stringify(afterServer));

  assert.ok(storage.has(LEGACY_SCORE_KEY));
  const legacy = JSON.parse(storage.get(LEGACY_SCORE_KEY));
  assert.equal(legacy.student_a_line.scorePct, 99);
  const saved = JSON.parse(storage.get(studentKey));
  assert.equal(saved.real_line.scorePct, 50);
  assert.equal(saved.student_a_line, undefined);
  assert.equal(saved.student_b_line, undefined);
});
