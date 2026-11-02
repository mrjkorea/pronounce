/** Per-student teacher path grants for Day 4 Pronounce (localStorage). */
import { idKey } from './progress-merge.js';

export const TEACHER_GRANT_KEY_PREFIX = 'day4-pronounce-teacher:';

export function teacherGrantStorageKey(studentId) {
  const key = idKey(studentId);
  return key ? `${TEACHER_GRANT_KEY_PREFIX}${key}` : '';
}

function parseGrant(raw) {
  if (!raw) return null;
  try {
    const g = JSON.parse(raw);
    if (!g || typeof g !== 'object') return null;
    if (g.mode === 'open') return { mode: 'open' };
    if (g.mode === 'start' && g.bookId && g.unitId) {
      return { mode: 'start', bookId: String(g.bookId), unitId: String(g.unitId) };
    }
    return null;
  } catch (_) {
    return null;
  }
}

export function readTeacherPathGrant(storage, studentId) {
  if (!storage) return null;
  const k = teacherGrantStorageKey(studentId);
  if (!k) return null;
  return parseGrant(storage.getItem(k));
}

export function writeTeacherPathGrant(storage, studentId, grant) {
  if (!storage) return;
  const k = teacherGrantStorageKey(studentId);
  if (!k) return;
  if (!grant) {
    storage.removeItem(k);
    return;
  }
  storage.setItem(k, JSON.stringify(grant));
}

export function setTeacherStartGrant(storage, studentId, bookId, unitId) {
  writeTeacherPathGrant(storage, studentId, {
    mode: 'start',
    bookId: String(bookId),
    unitId: String(unitId),
  });
}

export function setTeacherOpenAllGrant(storage, studentId) {
  writeTeacherPathGrant(storage, studentId, { mode: 'open' });
}

export function clearTeacherPathGrant(storage, studentId) {
  writeTeacherPathGrant(storage, studentId, null);
}

export function listTeacherPathGrants(storage, studentId) {
  const grant = readTeacherPathGrant(storage, studentId);
  return grant ? [{ grant }] : [];
}
