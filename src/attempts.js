/**
 * Try again — append-only attempt record for one Day 4 sheet (one page_id).
 *
 * Rule (TRY_AGAIN_SPEC §5): a re-attempt can only add. Nothing is removed,
 * edited or overwritten — not an earlier row, not the first date, not the best
 * score, not a pass, not a teacher pass, not a path square.
 *
 * Pure: no localStorage, no DOM. app.js owns the storage key and the student.
 */

export const ATTEMPTS_STORAGE_KEY = 'day4-pronounce-attempts-v1';

export function pageIdFor(bookId, unitId) {
  return `pronounce:${bookId}:${unitId}`;
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** One attempt row from whatever an older build stored (single result = try 1). */
function normalizeAttemptRow(row, index) {
  const raw = plainObject(row);
  const n = num(raw.n, index + 1);
  return {
    n: n > 0 ? n : index + 1,
    startedAt: raw.startedAt ? String(raw.startedAt) : '',
    endedAt: raw.endedAt ? String(raw.endedAt) : '',
    score: num(raw.score, 0),
    pass: !!raw.pass,
    correct: num(raw.correct, 0),
    total: num(raw.total, 0),
    missed: Array.isArray(raw.missed) ? raw.missed.map(String) : [],
    source: raw.source === 'teacher' ? 'teacher' : 'student',
  };
}

export function normalizeRecord(pageId, raw) {
  const src = plainObject(raw);
  const attempts = Array.isArray(src.attempts)
    ? src.attempts.map((row, i) => normalizeAttemptRow(row, i))
    : [];
  const base = {
    page_id: pageId,
    firstDoneAt: src.firstDoneAt ? String(src.firstDoneAt) : '',
    lastAttemptAt: src.lastAttemptAt ? String(src.lastAttemptAt) : '',
    bestScore: src.bestScore == null ? null : num(src.bestScore, null),
    pass: !!src.pass,
    attemptCount: 0,
    attempts,
  };
  base.attemptCount = Math.max(
    attempts.length,
    num(src.attemptCount, 0),
    num(src.tries, 0),
  );
  return base;
}

export function readStore(rawJson) {
  let parsed = {};
  try {
    parsed = typeof rawJson === 'string' ? JSON.parse(rawJson || '{}') : plainObject(rawJson);
  } catch (_) {
    parsed = {};
  }
  const store = plainObject(parsed);
  const out = {};
  for (const pageId of Object.keys(store)) out[pageId] = normalizeRecord(pageId, store[pageId]);
  return out;
}

export function writeStore(store) {
  const out = {};
  for (const pageId of Object.keys(plainObject(store))) {
    const rec = normalizeRecord(pageId, store[pageId]);
    out[pageId] = {
      page_id: rec.page_id,
      firstDoneAt: rec.firstDoneAt,
      lastAttemptAt: rec.lastAttemptAt,
      bestScore: rec.bestScore,
      pass: rec.pass,
      attemptCount: rec.attemptCount,
      attempts: rec.attempts,
    };
  }
  return JSON.stringify(out);
}

export function recordFor(store, pageId) {
  const rec = plainObject(store)[pageId];
  return rec ? normalizeRecord(pageId, rec) : normalizeRecord(pageId, null);
}

export function bestScoreOf(store, pageId) {
  const rec = recordFor(store, pageId);
  if (rec.bestScore != null) return rec.bestScore;
  if (!rec.attempts.length) return null;
  return rec.attempts.reduce((best, row) => (row.score > best ? row.score : best), rec.attempts[0].score);
}

/** Try N a finished attempt is: one more than the attempts already kept. */
export function nextTryNo(store, pageId) {
  return recordFor(store, pageId).attemptCount + 1;
}

export function hasAttempt(store, pageId, n) {
  return recordFor(store, pageId).attempts.some((row) => row.n === n);
}

/**
 * Append one finished attempt. Returns a new store; the old one is untouched.
 * If the same try number is already kept, nothing changes (reload-safe).
 */
export function appendAttempt(store, pageId, attempt) {
  const prev = recordFor(store, pageId);
  const row = normalizeAttemptRow(attempt, prev.attempts.length);
  if (prev.attempts.some((kept) => kept.n === row.n)) {
    return Object.assign({}, plainObject(store), { [pageId]: prev });
  }
  const attempts = prev.attempts.concat([row]).sort((a, b) => a.n - b.n);
  const bestByScore = attempts.reduce(
    (best, item) => (best == null || item.score > best ? item.score : best),
    null,
  );
  const bestScore = prev.bestScore == null ? bestByScore : Math.max(prev.bestScore, bestByScore);
  const rec = {
    page_id: pageId,
    firstDoneAt: prev.firstDoneAt || row.endedAt || '',
    lastAttemptAt: row.endedAt || prev.lastAttemptAt || '',
    bestScore,
    pass: prev.pass || row.pass,
    attemptCount: Math.max(prev.attemptCount, attempts.length),
    attempts,
  };
  const next = Object.assign({}, plainObject(store));
  next[pageId] = rec;
  return next;
}

/** "Best 90% (try 1)" — the best attempt and which try it was. */
export function bestLabel(store, pageId) {
  const rec = recordFor(store, pageId);
  if (!rec.attempts.length) return '';
  let bestRow = rec.attempts[0];
  for (const row of rec.attempts) {
    if (row.score > bestRow.score) bestRow = row;
  }
  const pct = Math.round(rec.bestScore == null ? bestRow.score : rec.bestScore);
  return `Best ${pct}% (try ${bestRow.n})`;
}
