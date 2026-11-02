import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearTeacherPathGrant,
  readTeacherPathGrant,
  setTeacherOpenAllGrant,
  setTeacherStartGrant,
  teacherGrantStorageKey,
} from '../src/teacher-grants.js';

const mem = () => {
  const map = new Map();
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, v); },
    removeItem(k) { map.delete(k); },
  };
};

test('teacher grant storage key is per student', () => {
  assert.equal(teacherGrantStorageKey('Amy'), 'day4-pronounce-teacher:amy');
});

test('start grant round-trips in localStorage', () => {
  const storage = mem();
  setTeacherStartGrant(storage, 'Amy', 'basic_a', 'unit03');
  assert.deepEqual(readTeacherPathGrant(storage, 'Amy'), {
    mode: 'start',
    bookId: 'basic_a',
    unitId: 'unit03',
  });
  clearTeacherPathGrant(storage, 'Amy');
  assert.equal(readTeacherPathGrant(storage, 'Amy'), null);
});

test('open-all grant', () => {
  const storage = mem();
  setTeacherOpenAllGrant(storage, 'bob');
  assert.deepEqual(readTeacherPathGrant(storage, 'bob'), { mode: 'open' });
});
